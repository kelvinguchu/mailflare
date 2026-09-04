import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messageAttachments, messages, outboundJobs } from "@/db/schema";
import { newId } from "@/lib/ids";
import { buildSnippet } from "@/lib/email/parse";
import { dispatchWebhooks } from "@/lib/email/webhooks";
import { upsertContactFromAddress } from "@/lib/contacts/service";
import { getAuthorizedSenderAddress } from "@/lib/email/sender";
import { createAuditLog } from "@/lib/mailboxes/audit";
import { storeMessageAttachments, validateAttachments } from "@/lib/email/attachments";
import type { AttachmentContent } from "@/lib/email/attachment-types";
import {
	getOutboundErrorCode,
	shouldRetryOutboundFailure,
} from "@/lib/email/outbound-policy";

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
	status: "queued";
};

type StoredOutboundPayload = {
	headers?: Record<string, string>;
};

export type OutboundQueueMessage = { jobId: string };

export async function queueEmail(env: CloudflareEnv, input: SendEmailInput): Promise<QueuedEmail> {
	const db = getDb(env);
	const sender = await getAuthorizedSenderAddress(env, input);
	const attachments = input.attachments ?? [];
	validateAttachments(attachments);
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
		});
		storedAttachments = await storeMessageAttachments(env, messageId, attachments);
		await db.insert(outboundJobs).values({
			id: jobId,
			userId: input.userId,
			messageId,
			status: "queued",
			payload: JSON.stringify({ headers: input.headers } satisfies StoredOutboundPayload),
		});
	} catch (error) {
		await Promise.allSettled(storedAttachments.map((attachment) => env.BUCKET.delete(attachment.r2Key)));
		await db.delete(messages).where(eq(messages.id, messageId));
		throw error;
	}

	try {
		await env.OUTBOUND_QUEUE.send({ jobId } satisfies OutboundQueueMessage);
	} catch (err) {
		const error = describeOutboundError(err);
		await markOutboundFailed(env, jobId, messageId, error);
		throw err;
	}

	return { jobId, messageId, status: "queued" };
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
	if (job.status !== "queued") return;
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
		await handleDeliveryFailure(env, job.id, message, error, options.attempt);
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
		await handleDeliveryFailure(env, job.id, message, error, options.attempt);
		return;
	}

	await db.batch([
		db
			.update(messages)
			.set({ status: "sent", providerMessageId: response.messageId })
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

async function handleDeliveryFailure(
	env: CloudflareEnv,
	jobId: string,
	message: typeof messages.$inferSelect,
	error: unknown,
	attempt: number,
): Promise<void> {
	const description = describeOutboundError(error);
	if (shouldRetryOutboundFailure(error, attempt)) {
		await getDb(env)
			.update(outboundJobs)
			.set({ error: description, updatedAt: new Date() })
			.where(eq(outboundJobs.id, jobId));
		throw new Error(`Retryable outbound delivery failure for ${jobId}`);
	}

	await markOutboundFailed(env, jobId, message.id, description);
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
		db.update(messages).set({ status: "failed" }).where(eq(messages.id, messageId)),
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
