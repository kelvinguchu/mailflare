import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { deadLetterEvents, messages, outboundJobs } from "@/db/schema";
import type { InboundQueueMessage } from "@/lib/email/inbound";
import type { OutboundQueueMessage } from "@/lib/email/send";
import { newId } from "@/lib/ids";
import {
	decideOutboundDeadLetterReplay,
	getDeadLetterSource,
	PRIMARY_QUEUE_RETRY_LIMIT,
	toSafeDiagnosticCode,
	type DeadLetterSource,
	type DeadLetterStatus,
} from "@/lib/queues/dead-letter-policy";

export type DeadLetterListItem = {
	id: string;
	sourceQueue: DeadLetterSource;
	referenceId: string | null;
	diagnosticCode: string;
	attemptCount: number;
	status: DeadLetterStatus;
	replayCount: number;
	messageCreatedAt: Date;
	createdAt: Date;
	updatedAt: Date;
	replayedAt: Date | null;
};

export class DeadLetterNotFoundError extends Error {
	constructor() {
		super("Delivery failure not found");
		this.name = "DeadLetterNotFoundError";
	}
}

export class DeadLetterReplayBlockedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DeadLetterReplayBlockedError";
	}
}

export async function captureDeadLetterMessage(
	env: CloudflareEnv,
	queueName: string,
	message: Message<unknown>,
): Promise<void> {
	const source = getDeadLetterSource(queueName);
	if (!source) throw new Error(`Unsupported dead-letter queue: ${queueName}`);

	const parsed = parseQueuePayload(source, message.body);
	const eventId = await createDeadLetterEventId(queueName, message.id);
	const now = Math.floor(Date.now() / 1_000);
	let diagnosticCode = parsed.valid ? "QUEUE_RETRIES_EXHAUSTED" : "MALFORMED_QUEUE_PAYLOAD";
	if (source === "outbound" && parsed.valid) {
		const [job] = await getDb(env)
			.select({ error: outboundJobs.error })
			.from(outboundJobs)
			.where(eq(outboundJobs.id, parsed.referenceId))
			.limit(1);
		diagnosticCode = toSafeDiagnosticCode(job?.error);
	}

	await env.DB.prepare(`
		INSERT INTO dead_letter_events (
			id, source_queue, dead_letter_queue, queue_message_id, reference_id,
			payload, diagnostic_code, attempt_count, status, replay_count,
			message_created_at, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unresolved', 0, ?, ?, ?)
		ON CONFLICT(dead_letter_queue, queue_message_id) DO UPDATE SET
			diagnostic_code = excluded.diagnostic_code,
			attempt_count = excluded.attempt_count,
			updated_at = excluded.updated_at
	`)
		.bind(
			eventId,
			source,
			queueName,
			message.id,
			parsed.referenceId,
			serializeQueuePayload(message.body),
			diagnosticCode,
			Math.max(message.attempts, PRIMARY_QUEUE_RETRY_LIMIT),
			Math.floor(message.timestamp.getTime() / 1_000),
			now,
			now,
		)
		.run();

	console.error(JSON.stringify({
		event: "queue_dead_letter_captured",
		deadLetterId: eventId,
		sourceQueue: source,
		referenceId: parsed.referenceId,
		diagnosticCode,
		attemptCount: Math.max(message.attempts, PRIMARY_QUEUE_RETRY_LIMIT),
	}));
}

export async function captureFinalOutboundFailure(
	env: CloudflareEnv,
	queueName: string,
	message: {
		id: string;
		timestamp: Date;
		attempts: number;
		body: OutboundQueueMessage;
	},
): Promise<void> {
	const db = getDb(env);
	const [job] = await db
		.select({
			id: outboundJobs.id,
			status: outboundJobs.status,
			error: outboundJobs.error,
			attemptCount: outboundJobs.attemptCount,
		})
		.from(outboundJobs)
		.where(eq(outboundJobs.id, message.body.jobId))
		.limit(1);
	if (!job || job.status !== "failed") return;

	const eventId = await createDeadLetterEventId(queueName, message.id);
	const now = Math.floor(Date.now() / 1_000);
	const diagnosticCode = toSafeDiagnosticCode(job.error);
	await env.DB.prepare(`
		INSERT INTO dead_letter_events (
			id, source_queue, dead_letter_queue, queue_message_id, reference_id,
			payload, diagnostic_code, attempt_count, status, replay_count,
			message_created_at, created_at, updated_at
		) VALUES (?, 'outbound', ?, ?, ?, ?, ?, ?, 'unresolved', 0, ?, ?, ?)
		ON CONFLICT(dead_letter_queue, queue_message_id) DO UPDATE SET
			diagnostic_code = excluded.diagnostic_code,
			attempt_count = excluded.attempt_count,
			updated_at = excluded.updated_at
	`)
		.bind(
			eventId,
			queueName,
			message.id,
			job.id,
			serializeQueuePayload(message.body),
			diagnosticCode,
			Math.max(job.attemptCount, message.attempts),
			Math.floor(message.timestamp.getTime() / 1_000),
			now,
			now,
		)
		.run();

	console.error(JSON.stringify({
		event: "outbound_delivery_failure_captured",
		deadLetterId: eventId,
		sourceQueue: "outbound",
		referenceId: job.id,
		diagnosticCode,
		attemptCount: Math.max(job.attemptCount, message.attempts),
	}));
}

export async function listDeadLetterEvents(
	env: CloudflareEnv,
	limit = 100,
): Promise<{ events: DeadLetterListItem[]; unresolvedCount: number }> {
	const db = getDb(env);
	const safeLimit = Math.max(1, Math.min(limit, 200));
	const [events, totals] = await Promise.all([
		db
			.select({
				id: deadLetterEvents.id,
				sourceQueue: deadLetterEvents.sourceQueue,
				referenceId: deadLetterEvents.referenceId,
				diagnosticCode: deadLetterEvents.diagnosticCode,
				attemptCount: deadLetterEvents.attemptCount,
				status: deadLetterEvents.status,
				replayCount: deadLetterEvents.replayCount,
				messageCreatedAt: deadLetterEvents.messageCreatedAt,
				createdAt: deadLetterEvents.createdAt,
				updatedAt: deadLetterEvents.updatedAt,
				replayedAt: deadLetterEvents.replayedAt,
			})
			.from(deadLetterEvents)
			.orderBy(desc(deadLetterEvents.createdAt))
			.limit(safeLimit),
		db
			.select({ value: count() })
			.from(deadLetterEvents)
			.where(eq(deadLetterEvents.status, "unresolved")),
	]);
	return {
		events: events as DeadLetterListItem[],
		unresolvedCount: totals[0]?.value ?? 0,
	};
}

export async function replayDeadLetterEvent(
	env: CloudflareEnv,
	eventId: string,
	actorUserId: string,
): Promise<{ outcome: string; alreadyReplayed: boolean }> {
	const db = getDb(env);
	const [event] = await db
		.select()
		.from(deadLetterEvents)
		.where(eq(deadLetterEvents.id, eventId))
		.limit(1);
	if (!event) throw new DeadLetterNotFoundError();
	if (event.status === "replayed") return { outcome: "already_replayed", alreadyReplayed: true };

	const now = Math.floor(Date.now() / 1_000);
	const staleBefore = now - 5 * 60;
	const claimed = await env.DB.prepare(`
		UPDATE dead_letter_events
		SET status = 'replaying', updated_at = ?
		WHERE id = ?
			AND (status = 'unresolved' OR (status = 'replaying' AND updated_at < ?))
		RETURNING id
	`)
		.bind(now, eventId, staleBefore)
		.first<{ id: string }>();
	if (!claimed) {
		const [current] = await db
			.select({ status: deadLetterEvents.status })
			.from(deadLetterEvents)
			.where(eq(deadLetterEvents.id, eventId))
			.limit(1);
		if (current?.status === "replayed") {
			return { outcome: "already_replayed", alreadyReplayed: true };
		}
		throw new DeadLetterReplayBlockedError("This failure is already being replayed");
	}

	try {
		const payload = JSON.parse(event.payload) as unknown;
		let outcome: string;
		if (event.sourceQueue === "inbound") {
			if (!isInboundQueueMessage(payload)) {
				throw new DeadLetterReplayBlockedError("The stored inbound queue payload is invalid");
			}
			await env.INBOUND_QUEUE.send(payload);
			outcome = "inbound_requeued";
		} else {
			if (!isOutboundQueueMessage(payload)) {
				throw new DeadLetterReplayBlockedError("The stored outbound queue payload is invalid");
			}
			outcome = await replayOutboundJob(env, payload, eventId);
		}

		const auditId = newId("aud");
		const metadata = JSON.stringify({
			deadLetterId: eventId,
			sourceQueue: event.sourceQueue,
			referenceId: event.referenceId,
			outcome,
		});
		await env.DB.batch([
			env.DB.prepare(`
				UPDATE dead_letter_events
				SET status = 'replayed', replay_count = replay_count + 1,
					replayed_at = ?, replayed_by_user_id = ?, updated_at = ?
				WHERE id = ? AND status = 'replaying'
			`).bind(now, actorUserId, now, eventId),
			env.DB.prepare(`
				INSERT INTO audit_logs (id, actor_user_id, action, metadata, created_at)
				VALUES (?, ?, 'queue.dead_letter.replay', ?, ?)
			`).bind(auditId, actorUserId, metadata, now),
		]);
		return { outcome, alreadyReplayed: false };
	} catch (error) {
		await env.DB.prepare(`
			UPDATE dead_letter_events
			SET status = 'unresolved', updated_at = ?
			WHERE id = ? AND status = 'replaying'
		`).bind(Math.floor(Date.now() / 1_000), eventId).run();
		throw error;
	}
}

async function replayOutboundJob(
	env: CloudflareEnv,
	payload: OutboundQueueMessage,
	deadLetterId: string,
): Promise<string> {
	const db = getDb(env);
	const [job] = await db
		.select()
		.from(outboundJobs)
		.where(eq(outboundJobs.id, payload.jobId))
		.limit(1);
	if (!job) throw new DeadLetterReplayBlockedError("The outbound job no longer exists");

	const decision = decideOutboundDeadLetterReplay(job);
	if (decision === "already_sent") return "outbound_already_sent";
	if (decision === "blocked_unknown_outcome") {
		throw new DeadLetterReplayBlockedError(
			"Replay is blocked because the provider may already have accepted this email",
		);
	}
	if (decision === "blocked_in_flight") {
		throw new DeadLetterReplayBlockedError("Replay is blocked while the outbound job is still in flight");
	}
	if (decision === "blocked_invalid_state") {
		throw new DeadLetterReplayBlockedError("The outbound job cannot be replayed from its current state");
	}

	if (decision === "reset_and_enqueue") {
		if (!job.messageId) throw new DeadLetterReplayBlockedError("The outbound message no longer exists");
		await db.batch([
			db
				.update(outboundJobs)
				.set({
					status: "queued",
					deliveryStartedAt: null,
					error: null,
					updatedAt: new Date(),
				})
				.where(and(eq(outboundJobs.id, job.id), eq(outboundJobs.status, "failed"))),
			db.update(messages).set({ status: "queued" }).where(eq(messages.id, job.messageId)),
		]);
	}

	await env.OUTBOUND_QUEUE.send(payload);
	console.info(JSON.stringify({
		event: "queue_dead_letter_requeued",
		deadLetterId,
		sourceQueue: "outbound",
		referenceId: payload.jobId,
	}));
	return "outbound_requeued";
}

async function createDeadLetterEventId(queueName: string, messageId: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(`${queueName}\0${messageId}`),
	);
	const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `dlq_${hex.slice(0, 32)}`;
}

function parseQueuePayload(
	source: DeadLetterSource,
	payload: unknown,
): { valid: true; referenceId: string } | { valid: false; referenceId: null } {
	if (source === "inbound" && isInboundQueueMessage(payload)) {
		return { valid: true, referenceId: payload.deliveryKey ?? payload.rawR2Key };
	}
	if (source === "outbound" && isOutboundQueueMessage(payload)) {
		return { valid: true, referenceId: payload.jobId };
	}
	return { valid: false, referenceId: null };
}

function isInboundQueueMessage(payload: unknown): payload is InboundQueueMessage {
	if (typeof payload !== "object" || payload === null) return false;
	const candidate = payload as Partial<InboundQueueMessage>;
	return (
		typeof candidate.from === "string" &&
		typeof candidate.to === "string" &&
		typeof candidate.rawR2Key === "string" &&
		candidate.rawR2Key.length > 0 &&
		(candidate.deliveryKey === undefined || typeof candidate.deliveryKey === "string") &&
		(candidate.headers === undefined || isStringRecord(candidate.headers))
	);
}

function isOutboundQueueMessage(payload: unknown): payload is OutboundQueueMessage {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"jobId" in payload &&
		typeof payload.jobId === "string" &&
		payload.jobId.length > 0
	);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every((item) => typeof item === "string")
	);
}

function serializeQueuePayload(payload: unknown): string {
	try {
		return JSON.stringify(payload) ?? "null";
	} catch {
		return "null";
	}
}
