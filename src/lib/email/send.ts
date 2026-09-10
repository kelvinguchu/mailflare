import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts, domains, mailboxes, messageAttachments, messages, outboundJobs, users } from "@/db/schema";
import { newId } from "@/lib/ids";
import { buildSnippet } from "@/lib/email/parse";
import { dispatchWebhooks } from "@/lib/email/webhooks";
import { upsertContactFromAddress } from "@/lib/contacts/service";
import { getAuthorizedSenderAddress } from "@/lib/email/sender";
import { createAuditLog } from "@/lib/mailboxes/audit";
import { storeMessageAttachments, validateAttachments } from "@/lib/email/attachments";
import type { AttachmentContent } from "@/lib/email/attachment-types";
import {
	decideOutboundFailure,
	getOutboundRetryDelaySeconds,
	getOutboundErrorCode,
	isOutboundDeliveryEnabled,
	MAX_OUTBOUND_DELIVERY_ATTEMPTS,
} from "@/lib/email/outbound-policy";
import {
	createOutboundRequestHash,
	createStoredIdempotencyKey,
	IdempotencyConflictError,
	normalizeIdempotencyKey,
} from "@/lib/email/outbound-idempotency";
import { claimOutboundDelivery } from "@/lib/email/outbound-claim";
import { getEmailAddress } from "@/lib/email/address";

export type SendEmailInput = {
	userId: string;
	from: string;
	to: string;
	subject: string;
	html?: string;
	text?: string;
	headers?: Record<string, string>;
	mailboxId: string;
	attachments?: AttachmentContent[];
};

export type QueuedEmail = {
	jobId: string;
	messageId: string;
	status: "queued" | "sending" | "sent" | "failed";
	idempotencyKey: string;
};

type StoredOutboundPayload = {
	headers?: Record<string, string>;
};

export type OutboundQueueMessage = { jobId: string };

export class OutboundRetryError extends Error {
	readonly delaySeconds: number;

	constructor(jobId: string, attempt: number) {
		super(`Retryable outbound delivery failure for ${jobId}`);
		this.name = "OutboundRetryError";
		this.delaySeconds = getOutboundRetryDelaySeconds(attempt);
	}
}

export async function queueEmail(
	env: CloudflareEnv,
	input: SendEmailInput,
	options?: { idempotencyKey?: string | null },
): Promise<QueuedEmail> {
	const db = getDb(env);
	const idempotencyKey = normalizeIdempotencyKey(options?.idempotencyKey);
	const sender = await getAuthorizedSenderAddress(env, input);
	const attachments = input.attachments ?? [];
	validateAttachments(attachments);
	const storedIdempotencyKey = await createStoredIdempotencyKey(input.userId, idempotencyKey);
	const requestHash = await createOutboundRequestHash({
		...input,
		from: sender.fromAddr,
		mailboxId: sender.mailboxId,
		attachments,
	});
	const existing = await findOutboundJobByIdempotencyKey(env, input.userId, storedIdempotencyKey);
	if (existing) {
		return acceptExistingOutboundJob(env, existing, requestHash, idempotencyKey);
	}
	const recipient = getEmailAddress(input.to).toLowerCase();
	const [suppressed] = await db.select({ id: contacts.id }).from(contacts).where(and(
		eq(contacts.userId, input.userId),
		eq(contacts.email, recipient),
		eq(contacts.blocked, true),
	)).limit(1);
	if (suppressed) {
		await auditRejectedSend(env, input, sender.mailboxId, "recipient_suppressed");
		throw new Error("Recipient is suppressed");
	}

	await upsertContactFromAddress(env, {
		userId: input.userId,
		address: input.to,
		source: "outbound",
	});
	const messageId = newId("msg");
	const snippet = buildSnippet(input.text ?? null, input.html ?? null);

	const jobId = newId("job");
	let storedAttachments: Awaited<ReturnType<typeof storeMessageAttachments>> = [];
	try {
		await db.insert(messages).values({
			id: messageId,
			userId: input.userId,
			mailboxId: sender.mailboxId,
			direction: "outbound",
			fromAddr: sender.fromAddr,
			toAddr: input.to,
			subject: input.subject,
			snippet,
			textBody: input.text ?? null,
			htmlBody: input.html ?? null,
			status: "queued",
			deliveryStatus: "queued",
			deliveryUpdatedAt: new Date(),
		});
		storedAttachments = await storeMessageAttachments(env, messageId, attachments);
		const limitFailure = await reserveOutboundJob(env, {
			id: jobId,
			userId: input.userId,
			domainId: sender.domainId,
			messageId,
			payload: JSON.stringify({ headers: input.headers } satisfies StoredOutboundPayload),
			idempotencyKey: storedIdempotencyKey,
			requestHash,
		});
		if (limitFailure) {
			await auditRejectedSend(env, input, sender.mailboxId, limitFailure.code);
			throw new Error(limitFailure.message);
		}
	} catch (error) {
		await Promise.allSettled(storedAttachments.map((attachment) => env.BUCKET.delete(attachment.r2Key)));
		await db.delete(messages).where(eq(messages.id, messageId));
		const raced = await findOutboundJobByIdempotencyKey(env, input.userId, storedIdempotencyKey);
		if (raced) return acceptExistingOutboundJob(env, raced, requestHash, idempotencyKey);
		throw error;
	}

	await enqueueOutboundJob(env, jobId);

	return { jobId, messageId, status: "queued", idempotencyKey };
}

export async function processOutboundQueue(
	env: CloudflareEnv,
	payload: OutboundQueueMessage,
	options: { attempt: number },
): Promise<void> {
	const db = getDb(env);
	const [job] = await db.select().from(outboundJobs).where(eq(outboundJobs.id, payload.jobId)).limit(1);
	if (!job) {
		console.error("Dropping outbound queue message for an unknown job", { jobId: payload.jobId });
		return;
	}
	if (job.status === "sent" || job.status === "failed") return;
	if (job.status === "sending") {
		await handleInFlightReplay(env, job, options.attempt);
		return;
	}
	if (!job.messageId) {
		await db
			.update(outboundJobs)
			.set({ status: "failed", error: "Outbound message is missing", updatedAt: new Date() })
			.where(eq(outboundJobs.id, job.id));
		return;
	}

	const [message] = await db.select().from(messages).where(eq(messages.id, job.messageId)).limit(1);
	if (!message || message.direction !== "outbound") {
		await markOutboundFailed(env, job.id, job.messageId, "Outbound message is missing");
		return;
	}
	if (!isOutboundDeliveryEnabled(env.OUTBOUND_DELIVERY_MODE)) {
		await recordFinalOutboundFailure(env, job.id, message, "E_OUTBOUND_DELIVERY_DISABLED");
		return;
	}
	const readinessError = await getQueuedSenderReadinessError(env, job.userId, message.mailboxId, job.domainId);
	if (readinessError) {
		await recordFinalOutboundFailure(env, job.id, message, readinessError);
		await auditRejectedSend(env, { userId: job.userId, to: message.toAddr }, message.mailboxId, readinessError);
		return;
	}

	let storedPayload: StoredOutboundPayload;
	try {
		storedPayload = parseStoredOutboundPayload(job.payload);
	} catch {
		await markOutboundFailed(env, job.id, message.id, "Outbound job payload is invalid");
		return;
	}

	let attachments: AttachmentContent[];
	try {
		attachments = await loadOutboundAttachments(env, message.id);
	} catch (error) {
		await handlePreDeliveryFailure(env, job.id, message, error, options.attempt);
		return;
	}

	const claimed = await claimOutboundDelivery(env.DB, job.id);
	if (!claimed) {
		const [current] = await db.select().from(outboundJobs).where(eq(outboundJobs.id, job.id)).limit(1);
		if (current?.status === "sending") await handleInFlightReplay(env, current, options.attempt);
		return;
	}

	let response: Awaited<ReturnType<CloudflareEnv["EMAIL"]["send"]>>;
	try {
		response = await env.EMAIL.send({
			from: message.fromAddr,
			to: message.toAddr,
			subject: message.subject ?? "",
			headers: storedPayload.headers,
			html: message.htmlBody ?? undefined,
			text: message.textBody ?? undefined,
			attachments: attachments.map(toEmailServiceAttachment),
		});
	} catch (error) {
		await handleProviderFailure(env, job.id, message, error, options.attempt);
		return;
	}

	await db.batch([
		db
			.update(messages)
			.set({
				status: "sent",
				providerMessageId: response.messageId,
				deliveryStatus: "accepted",
				deliveryDetail: "Accepted by Cloudflare Email Service; final delivery has not been reported",
				deliveryUpdatedAt: new Date(),
			})
			.where(eq(messages.id, message.id)),
		db
			.update(outboundJobs)
			.set({ status: "sent", error: null, updatedAt: new Date() })
			.where(eq(outboundJobs.id, job.id)),
	]);

	const sideEffects = await Promise.allSettled([
		dispatchWebhooks(env, message.userId, "message.outbound", {
			messageId: message.id,
			providerMessageId: response.messageId,
			to: message.toAddr,
		}),
		createAuditLog(env, {
			actorUserId: message.userId,
			mailboxId: message.mailboxId,
			messageId: message.id,
			action: "email.send",
			metadata: { to: message.toAddr, subject: message.subject },
		}),
	]);
	if (sideEffects.some((result) => result.status === "rejected")) {
		console.error("Outbound post-delivery side effect failed", { jobId: job.id });
	}
}

type OutboundJob = typeof outboundJobs.$inferSelect;

async function findOutboundJobByIdempotencyKey(
	env: CloudflareEnv,
	userId: string,
	idempotencyKey: string,
): Promise<OutboundJob | null> {
	const [job] = await getDb(env)
		.select()
		.from(outboundJobs)
		.where(and(
			eq(outboundJobs.userId, userId),
			eq(outboundJobs.idempotencyKey, idempotencyKey),
		))
		.limit(1);
	return job ?? null;
}

async function acceptExistingOutboundJob(
	env: CloudflareEnv,
	job: OutboundJob,
	requestHash: string,
	idempotencyKey: string,
): Promise<QueuedEmail> {
	if (!job.requestHash || job.requestHash !== requestHash) throw new IdempotencyConflictError();
	if (!job.messageId) throw new Error("The existing outbound job has no message");
	if (job.status === "queued") await enqueueOutboundJob(env, job.id);
	return {
		jobId: job.id,
		messageId: job.messageId,
		status: job.status,
		idempotencyKey,
	};
}

async function enqueueOutboundJob(env: CloudflareEnv, jobId: string): Promise<void> {
	try {
		await env.OUTBOUND_QUEUE.send({ jobId } satisfies OutboundQueueMessage);
		await getDb(env)
			.update(outboundJobs)
			.set({ error: null, updatedAt: new Date() })
			.where(and(eq(outboundJobs.id, jobId), eq(outboundJobs.status, "queued")));
	} catch (error) {
		await getDb(env)
			.update(outboundJobs)
			.set({ error: "Outbound queue enqueue failed", updatedAt: new Date() })
			.where(and(eq(outboundJobs.id, jobId), eq(outboundJobs.status, "queued")));
		throw error;
	}
}

type OutboundReservation = {
	id: string;
	userId: string;
	domainId: string;
	messageId: string;
	payload: string;
	idempotencyKey: string;
	requestHash: string;
};

async function reserveOutboundJob(
	env: CloudflareEnv,
	input: OutboundReservation,
): Promise<{ code: string; message: string } | null> {
	const result = await env.DB.prepare(`
		INSERT INTO outbound_jobs (
			id, user_id, message_id, domain_id, status, payload, idempotency_key,
			request_hash, attempt_count, created_at, updated_at
		)
		SELECT ?, ?, ?, ?, 'queued', ?, ?, ?, 0, unixepoch(), unixepoch()
		FROM users AS u, domains AS d
		WHERE u.id = ? AND d.id = ?
			AND u.disabled = 0 AND u.activation_status = 'active'
			AND d.status = 'active' AND d.sending_enabled = 1
			AND (SELECT COUNT(*) FROM outbound_jobs
				WHERE user_id = ? AND created_at >= unixepoch() - 60) < u.send_rate_limit_per_minute
			AND (SELECT COUNT(*) FROM outbound_jobs
				WHERE domain_id = ? AND created_at >= unixepoch() - 60) < d.send_rate_limit_per_minute
			AND (SELECT COUNT(*) FROM outbound_jobs
				WHERE user_id = ? AND created_at >= unixepoch() - 86400) < u.daily_send_limit
			AND (SELECT COUNT(*) FROM outbound_jobs
				WHERE domain_id = ? AND created_at >= unixepoch() - 86400) < d.daily_send_limit
	`).bind(
		input.id, input.userId, input.messageId, input.domainId, input.payload,
		input.idempotencyKey, input.requestHash, input.userId, input.domainId,
		input.userId, input.domainId, input.userId, input.domainId,
	).run();
	if ((result.meta.changes ?? 0) > 0) return null;

	const status = await env.DB.prepare(`
		SELECT u.disabled, u.activation_status, u.send_rate_limit_per_minute AS user_rate,
			u.daily_send_limit AS user_daily, d.status AS domain_status,
			d.sending_enabled, d.send_rate_limit_per_minute AS domain_rate,
			d.daily_send_limit AS domain_daily,
			(SELECT COUNT(*) FROM outbound_jobs WHERE user_id = u.id AND created_at >= unixepoch() - 60) AS user_minute,
			(SELECT COUNT(*) FROM outbound_jobs WHERE domain_id = d.id AND created_at >= unixepoch() - 60) AS domain_minute,
			(SELECT COUNT(*) FROM outbound_jobs WHERE user_id = u.id AND created_at >= unixepoch() - 86400) AS user_day,
			(SELECT COUNT(*) FROM outbound_jobs WHERE domain_id = d.id AND created_at >= unixepoch() - 86400) AS domain_day
		FROM users u, domains d WHERE u.id = ? AND d.id = ?
	`).bind(input.userId, input.domainId).first<Record<string, string | number>>();
	if (!status || Number(status.disabled) || status.activation_status !== "active") {
		return { code: "account_disabled", message: "Sender account not found" };
	}
	if (status.domain_status !== "active" || !Number(status.sending_enabled)) {
		return { code: "domain_not_ready", message: "Sender domain is not ready for sending" };
	}
	if (Number(status.user_day) >= Number(status.user_daily)) {
		return { code: "user_daily_limit", message: "User daily send limit reached" };
	}
	if (Number(status.domain_day) >= Number(status.domain_daily)) {
		return { code: "domain_daily_limit", message: "Domain daily send limit reached" };
	}
	if (Number(status.user_minute) >= Number(status.user_rate)) {
		return { code: "user_rate_limit", message: "User send rate limit reached" };
	}
	return { code: "domain_rate_limit", message: "Domain send rate limit reached" };
}

async function getQueuedSenderReadinessError(
	env: CloudflareEnv,
	userId: string,
	mailboxId: string | null,
	domainId: string | null,
): Promise<string | null> {
	if (!mailboxId || !domainId) return "E_SENDER_MAILBOX_MISSING";
	const [state] = await getDb(env)
		.select({
			userDisabled: users.disabled,
			activationStatus: users.activationStatus,
			mailboxDisabled: mailboxes.disabled,
			domainStatus: domains.status,
			sendingEnabled: domains.sendingEnabled,
		})
		.from(users)
		.innerJoin(mailboxes, eq(mailboxes.id, mailboxId))
		.innerJoin(domains, eq(domains.id, domainId))
		.where(eq(users.id, userId))
		.limit(1);
	if (!state || state.userDisabled || state.activationStatus !== "active") return "E_SENDER_ACCOUNT_DISABLED";
	if (state.mailboxDisabled) return "E_SENDER_MAILBOX_DISABLED";
	if (state.domainStatus !== "active" || !state.sendingEnabled) return "E_SENDER_DOMAIN_NOT_READY";
	return null;
}

async function auditRejectedSend(
	env: CloudflareEnv,
	input: Pick<SendEmailInput, "userId" | "to">,
	mailboxId: string | null,
	reason: string,
): Promise<void> {
	await createAuditLog(env, {
		actorUserId: input.userId,
		mailboxId,
		action: "email.send_rejected",
		metadata: { recipientDomain: getEmailAddress(input.to).split("@")[1] ?? "unknown", reason },
	});
}

async function loadOutboundAttachments(env: CloudflareEnv, messageId: string): Promise<AttachmentContent[]> {
	const rows = await getDb(env)
		.select()
		.from(messageAttachments)
		.where(eq(messageAttachments.messageId, messageId));

	return Promise.all(rows.map(async (attachment) => {
		const object = await env.BUCKET.get(attachment.r2Key);
		if (!object) {
			throw Object.assign(new Error("A stored outbound attachment is missing"), {
				code: "E_STORED_ATTACHMENT_MISSING",
			});
		}
		return {
			filename: attachment.filename,
			type: attachment.contentType,
			content: await object.arrayBuffer(),
			disposition: attachment.disposition as "attachment" | "inline",
			contentId: attachment.contentId,
		};
	}));
}

function toEmailServiceAttachment(attachment: AttachmentContent) {
	return attachment.disposition === "inline" && attachment.contentId
		? {
				filename: attachment.filename,
				type: attachment.type,
				content: attachment.content,
				disposition: "inline" as const,
				contentId: attachment.contentId,
			}
		: {
				filename: attachment.filename,
				type: attachment.type,
				content: attachment.content,
				disposition: "attachment" as const,
			};
}

function parseStoredOutboundPayload(payload: string): StoredOutboundPayload {
	const parsed = JSON.parse(payload) as unknown;
	if (typeof parsed !== "object" || parsed === null) throw new Error("Invalid payload");
	const headers = "headers" in parsed ? (parsed as { headers?: unknown }).headers : undefined;
	if (headers === undefined) return {};
	if (typeof headers !== "object" || headers === null || Array.isArray(headers)) throw new Error("Invalid headers");
	for (const [name, value] of Object.entries(headers)) {
		if (!name || typeof value !== "string") throw new Error("Invalid headers");
	}
	return { headers: headers as Record<string, string> };
}

async function handlePreDeliveryFailure(
	env: CloudflareEnv,
	jobId: string,
	message: typeof messages.$inferSelect,
	error: unknown,
	attempt: number,
): Promise<void> {
	const description = describeOutboundError(error);
	if (decideOutboundFailure(error, attempt, false) === "retry") {
		await getDb(env)
			.update(outboundJobs)
			.set({ error: description, updatedAt: new Date() })
			.where(eq(outboundJobs.id, jobId));
		throw new OutboundRetryError(jobId, attempt);
	}

	await recordFinalOutboundFailure(env, jobId, message, description);
}

async function handleProviderFailure(
	env: CloudflareEnv,
	jobId: string,
	message: typeof messages.$inferSelect,
	error: unknown,
	attempt: number,
): Promise<void> {
	const action = decideOutboundFailure(error, attempt, true);
	if (action === "retry") {
		await getDb(env)
			.update(outboundJobs)
			.set({
				status: "queued",
				deliveryStartedAt: null,
				error: describeOutboundError(error),
				updatedAt: new Date(),
			})
			.where(and(eq(outboundJobs.id, jobId), eq(outboundJobs.status, "sending")));
		throw new OutboundRetryError(jobId, attempt);
	}

	const description = action === "unknown"
		? "E_DELIVERY_OUTCOME_UNKNOWN"
		: describeOutboundError(error);
	await recordFinalOutboundFailure(env, jobId, message, description);
}

async function handleInFlightReplay(
	env: CloudflareEnv,
	job: OutboundJob,
	attempt: number,
): Promise<void> {
	const startedAt = job.deliveryStartedAt?.getTime() ?? 0;
	const withinGracePeriod = startedAt > 0 && Date.now() - startedAt < 60_000;
	if (withinGracePeriod && attempt < MAX_OUTBOUND_DELIVERY_ATTEMPTS) {
		throw new OutboundRetryError(job.id, attempt);
	}
	if (job.messageId) {
		const [message] = await getDb(env).select().from(messages).where(eq(messages.id, job.messageId)).limit(1);
		if (message) await recordFinalOutboundFailure(env, job.id, message, "E_DELIVERY_OUTCOME_UNKNOWN");
	}
}

async function recordFinalOutboundFailure(
	env: CloudflareEnv,
	jobId: string,
	message: typeof messages.$inferSelect,
	description: string,
): Promise<void> {

	await markOutboundFailed(env, jobId, message.id, description);
	if (description === "E_RECIPIENT_SUPPRESSED") {
		const recipient = getEmailAddress(message.toAddr).toLowerCase();
		await getDb(env).update(contacts).set({ blocked: true }).where(and(
			eq(contacts.userId, message.userId),
			eq(contacts.email, recipient),
		));
	}
	const webhookResult = await Promise.allSettled([
		dispatchWebhooks(env, message.userId, "message.failed", {
			messageId: message.id,
			error: description,
		}),
	]);
	if (webhookResult[0]?.status === "rejected") {
		console.error("Outbound failure webhook dispatch failed", { jobId });
	}
}

async function markOutboundFailed(
	env: CloudflareEnv,
	jobId: string,
	messageId: string,
	error: string,
): Promise<void> {
	const db = getDb(env);
	await db.batch([
		db.update(messages).set({
			status: "failed",
			deliveryStatus: error === "E_RECIPIENT_SUPPRESSED" ? "suppressed" : error === "E_DELIVERY_OUTCOME_UNKNOWN" ? "unknown" : "failed",
			deliveryDetail: error.slice(0, 1_000),
			deliveryUpdatedAt: new Date(),
		}).where(eq(messages.id, messageId)),
		db
			.update(outboundJobs)
			.set({ status: "failed", error: error.slice(0, 1_000), updatedAt: new Date() })
			.where(eq(outboundJobs.id, jobId)),
	]);
}

function describeOutboundError(error: unknown): string {
	const code = getOutboundErrorCode(error);
	if (code) return code;
	if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 1_000);
	return "Outbound delivery failed";
}
