import { and, eq, inArray, lte, or } from "drizzle-orm";
import { getDb } from "@/db";
import {
	auditLogs,
	deadLetterEvents,
	messageAttachments,
	messages,
	outboundJobs,
	storageDeletionJobs,
	webhookDeliveries,
} from "@/db/schema";
import type { SessionUser } from "@/lib/auth/types";
import { newId } from "@/lib/ids";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";

export const STORAGE_RETENTION_DAYS = {
	trash: 30,
	auditLogs: 365,
	webhookDeliveries: 30,
	deadLettersReplayed: 30,
	deadLettersUnresolvedOrStuck: 180,
	failedOutboundJobs: 90,
	completedDeletionJobs: 30,
} as const;

const DAY_MS = 24 * 60 * 60 * 1_000;
const ORPHAN_GRACE_MS = DAY_MS;
const DELETE_BATCH_SIZE = 100;
const ORPHAN_PAGE_SIZE = 500;
const ORPHAN_PREFIXES = [
	"inbound/",
	"attachments/",
	"signatures/",
	"avatars/",
	"mailbox-avatars/",
	"branding/",
] as const;

type DeletionReason = "user" | "draft" | "retention";
type DeleteRequestResult =
	| { outcome: "not_found" }
	| { outcome: "not_allowed" }
	| { outcome: "accepted"; jobId: string; completed: boolean };

type LifecycleResult = {
	trashQueued: number;
	deletionsCompleted: number;
	deletionsFailed: number;
	orphansDeleted: number;
	auditLogsDeleted: number;
	webhookDeliveriesDeleted: number;
	deadLettersDeleted: number;
	failedJobsDeleted: number;
	completedDeletionJobsDeleted: number;
};

export async function requestPermanentMessageDeletion(
	env: CloudflareEnv,
	user: SessionUser,
	messageId: string,
): Promise<DeleteRequestResult> {
	const db = getDb(env);
	const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
	if (!message?.mailboxId) return { outcome: "not_found" };
	const access = await getMailboxAccessLevel(db, user, message.mailboxId);
	if (!access?.canManage) return { outcome: "not_found" };
	if (message.status !== "trash") return { outcome: "not_allowed" };
	return enqueueAndProcessDeletion(env, message, "user", user.id);
}

export async function requestDraftDeletion(
	env: CloudflareEnv,
	userId: string,
	messageId: string,
): Promise<DeleteRequestResult> {
	const db = getDb(env);
	const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
	if (!message || message.userId !== userId || message.status !== "draft") {
		return { outcome: "not_found" };
	}
	return enqueueAndProcessDeletion(env, message, "draft", userId);
}

export async function runStorageLifecycleMaintenance(
	env: CloudflareEnv,
	now = new Date(),
): Promise<LifecycleResult> {
	const result: LifecycleResult = {
		trashQueued: 0,
		deletionsCompleted: 0,
		deletionsFailed: 0,
		orphansDeleted: 0,
		auditLogsDeleted: 0,
		webhookDeliveriesDeleted: 0,
		deadLettersDeleted: 0,
		failedJobsDeleted: 0,
		completedDeletionJobsDeleted: 0,
	};

	result.trashQueued = await enqueueExpiredTrash(env, now);
	const deletionResult = await processDueDeletionJobs(env, now);
	result.deletionsCompleted = deletionResult.completed;
	result.deletionsFailed = deletionResult.failed;

	const db = getDb(env);
	result.webhookDeliveriesDeleted = changed(
		await db
			.delete(webhookDeliveries)
			.where(
				lte(webhookDeliveries.createdAt, cutoff(now, STORAGE_RETENTION_DAYS.webhookDeliveries)),
			),
	);
	result.deadLettersDeleted = changed(
		await db
			.delete(deadLetterEvents)
			.where(
				or(
					and(
						eq(deadLetterEvents.status, "replayed"),
						lte(
							deadLetterEvents.updatedAt,
							cutoff(now, STORAGE_RETENTION_DAYS.deadLettersReplayed),
						),
					),
					and(
						inArray(deadLetterEvents.status, ["unresolved", "replaying"]),
						lte(
							deadLetterEvents.createdAt,
							cutoff(now, STORAGE_RETENTION_DAYS.deadLettersUnresolvedOrStuck),
						),
					),
				),
			),
	);
	result.failedJobsDeleted = changed(
		await db
			.delete(outboundJobs)
			.where(
				and(
					inArray(outboundJobs.status, ["failed", "canceled"]),
					lte(outboundJobs.updatedAt, cutoff(now, STORAGE_RETENTION_DAYS.failedOutboundJobs)),
				),
			),
	);
	result.auditLogsDeleted = changed(
		await db
			.delete(auditLogs)
			.where(lte(auditLogs.createdAt, cutoff(now, STORAGE_RETENTION_DAYS.auditLogs))),
	);
	result.completedDeletionJobsDeleted = changed(
		await db
			.delete(storageDeletionJobs)
			.where(
				and(
					eq(storageDeletionJobs.status, "completed"),
					lte(
						storageDeletionJobs.completedAt,
						cutoff(now, STORAGE_RETENTION_DAYS.completedDeletionJobs),
					),
				),
			),
	);

	result.orphansDeleted = await cleanOneOrphanPagePerPrefix(env, now);
	return result;
}

async function enqueueAndProcessDeletion(
	env: CloudflareEnv,
	message: typeof messages.$inferSelect,
	reason: DeletionReason,
	actorUserId: string | null,
): Promise<DeleteRequestResult> {
	const jobId = await ensureDeletionJob(env, message, reason, actorUserId);
	const completed = await processDeletionJob(env, jobId, new Date());
	return { outcome: "accepted", jobId, completed };
}

async function ensureDeletionJob(
	env: CloudflareEnv,
	message: typeof messages.$inferSelect,
	reason: DeletionReason,
	actorUserId: string | null,
): Promise<string> {
	const db = getDb(env);
	const [existing] = await db
		.select({ id: storageDeletionJobs.id })
		.from(storageDeletionJobs)
		.where(eq(storageDeletionJobs.messageId, message.id))
		.limit(1);
	if (existing) return existing.id;

	const attachments = await db
		.select({ r2Key: messageAttachments.r2Key })
		.from(messageAttachments)
		.where(eq(messageAttachments.messageId, message.id));
	const objectKeys = [message.rawR2Key, ...attachments.map((item) => item.r2Key)].filter(
		(key): key is string => typeof key === "string" && key.length > 0,
	);
	const jobId = newId("del");
	const now = new Date();
	await db
		.insert(storageDeletionJobs)
		.values({
			id: jobId,
			messageId: message.id,
			actorUserId,
			mailboxId: message.mailboxId,
			reason,
			objectKeys: JSON.stringify([...new Set(objectKeys)]),
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing({ target: storageDeletionJobs.messageId });
	const [job] = await db
		.select({ id: storageDeletionJobs.id })
		.from(storageDeletionJobs)
		.where(eq(storageDeletionJobs.messageId, message.id))
		.limit(1);
	if (!job) throw new Error("Deletion job could not be persisted");
	await insertDeletionAudit(
		env,
		`aud_req_${job.id}`,
		job.id,
		message,
		actorUserId,
		reason,
		"requested",
	);
	return job.id;
}

async function processDeletionJob(env: CloudflareEnv, jobId: string, now: Date): Promise<boolean> {
	const db = getDb(env);
	const [job] = await db
		.select()
		.from(storageDeletionJobs)
		.where(eq(storageDeletionJobs.id, jobId))
		.limit(1);
	if (!job || job.status === "completed") return true;

	await db
		.update(storageDeletionJobs)
		.set({ status: "processing", attemptCount: job.attemptCount + 1, updatedAt: now })
		.where(eq(storageDeletionJobs.id, job.id));
	try {
		const keys = parseObjectKeys(job.objectKeys);
		for (let index = 0; index < keys.length; index += 1_000) {
			await env.BUCKET.delete(keys.slice(index, index + 1_000));
		}
		const [message] = await db
			.select()
			.from(messages)
			.where(eq(messages.id, job.messageId))
			.limit(1);
		if (message) {
			await insertDeletionAudit(
				env,
				`aud_done_${job.id}`,
				job.id,
				message,
				job.actorUserId,
				job.reason,
				"completed",
			);
			await db.delete(messages).where(eq(messages.id, job.messageId));
		}
		await db
			.update(storageDeletionJobs)
			.set({
				status: "completed",
				lastError: null,
				nextAttemptAt: null,
				completedAt: now,
				updatedAt: now,
			})
			.where(eq(storageDeletionJobs.id, job.id));
		return true;
	} catch (error) {
		const retryAt = new Date(now.getTime() + retryDelayMs(job.attemptCount + 1));
		const errorCode =
			error instanceof Error ? deletionErrorCode(error) : "E_STORAGE_DELETION_FAILED";
		await db
			.update(storageDeletionJobs)
			.set({ status: "failed", lastError: errorCode, nextAttemptAt: retryAt, updatedAt: now })
			.where(eq(storageDeletionJobs.id, job.id));
		console.error(JSON.stringify({ event: "storage_deletion_failed", jobId: job.id, errorCode }));
		return false;
	}
}

async function enqueueExpiredTrash(env: CloudflareEnv, now: Date): Promise<number> {
	const db = getDb(env);
	const expired = await db
		.select()
		.from(messages)
		.where(
			and(
				eq(messages.status, "trash"),
				lte(messages.trashedAt, cutoff(now, STORAGE_RETENTION_DAYS.trash)),
			),
		)
		.limit(DELETE_BATCH_SIZE);
	for (const message of expired) await ensureDeletionJob(env, message, "retention", null);
	return expired.length;
}

async function processDueDeletionJobs(
	env: CloudflareEnv,
	now: Date,
): Promise<{ completed: number; failed: number }> {
	const db = getDb(env);
	const staleProcessing = new Date(now.getTime() - 15 * 60 * 1_000);
	const jobs = await db
		.select({ id: storageDeletionJobs.id })
		.from(storageDeletionJobs)
		.where(
			or(
				eq(storageDeletionJobs.status, "pending"),
				and(eq(storageDeletionJobs.status, "failed"), lte(storageDeletionJobs.nextAttemptAt, now)),
				and(
					eq(storageDeletionJobs.status, "processing"),
					lte(storageDeletionJobs.updatedAt, staleProcessing),
				),
			),
		)
		.limit(DELETE_BATCH_SIZE);
	let completed = 0;
	let failed = 0;
	for (const job of jobs) {
		if (await processDeletionJob(env, job.id, now)) completed += 1;
		else failed += 1;
	}
	return { completed, failed };
}

async function insertDeletionAudit(
	env: CloudflareEnv,
	auditId: string,
	jobId: string,
	message: typeof messages.$inferSelect,
	actorUserId: string | null,
	reason: DeletionReason,
	phase: "requested" | "completed",
): Promise<void> {
	await env.DB.prepare(
		`INSERT OR IGNORE INTO audit_logs
		 (id, actor_user_id, mailbox_id, message_id, action, metadata, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, unixepoch())`,
	)
		.bind(
			auditId,
			actorUserId,
			message.mailboxId,
			message.id,
			phase === "requested" ? "email.permanent_delete_requested" : "email.permanent_deleted",
			JSON.stringify({ jobId, messageId: message.id, reason }),
		)
		.run();
}

async function cleanOneOrphanPagePerPrefix(env: CloudflareEnv, now: Date): Promise<number> {
	let deleted = 0;
	for (const prefix of ORPHAN_PREFIXES) {
		const state = await env.DB.prepare(
			"SELECT cursor FROM storage_lifecycle_state WHERE prefix = ?",
		)
			.bind(prefix)
			.first<{ cursor: string | null }>();
		const page = await env.BUCKET.list({
			prefix,
			limit: ORPHAN_PAGE_SIZE,
			...(state?.cursor ? { cursor: state.cursor } : {}),
		});
		const candidates = page.objects.filter(
			(object) => now.getTime() - object.uploaded.getTime() >= ORPHAN_GRACE_MS,
		);
		const orphanKeys = await findUnreferencedKeys(
			env,
			prefix,
			candidates.map((object) => object.key),
		);
		if (orphanKeys.length > 0) {
			await env.BUCKET.delete(orphanKeys);
			deleted += orphanKeys.length;
		}
		await env.DB.prepare(
			`INSERT INTO storage_lifecycle_state (prefix, cursor, last_scanned_at, updated_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(prefix) DO UPDATE SET
			 cursor = excluded.cursor,
			 last_scanned_at = excluded.last_scanned_at,
			 updated_at = excluded.updated_at`,
		)
			.bind(prefix, page.truncated ? page.cursor : null, unixSeconds(now), unixSeconds(now))
			.run();
	}
	return deleted;
}

async function findUnreferencedKeys(
	env: Pick<CloudflareEnv, "DB">,
	prefix: (typeof ORPHAN_PREFIXES)[number],
	keys: string[],
): Promise<string[]> {
	if (keys.length === 0) return [];
	const results = await env.DB.batch(
		keys.map((key) => objectReferenceStatement(env.DB, prefix, key)),
	);
	return keys.filter((_key, index) => results[index]?.results.length === 0);
}

function objectReferenceStatement(
	db: D1Database,
	prefix: (typeof ORPHAN_PREFIXES)[number],
	key: string,
): D1PreparedStatement {
	if (prefix === "inbound/") {
		return db
			.prepare(
				`SELECT 1 AS found FROM messages WHERE raw_r2_key = ?
				 UNION ALL
				 SELECT 1 AS found FROM dead_letter_events
				 WHERE CASE WHEN json_valid(payload) THEN json_extract(payload, '$.rawR2Key') END = ?
				 LIMIT 1`,
			)
			.bind(key, key);
	}
	if (prefix === "attachments/") {
		return db
			.prepare("SELECT 1 AS found FROM message_attachments WHERE r2_key = ? LIMIT 1")
			.bind(key);
	}
	if (prefix === "signatures/") {
		return db.prepare("SELECT 1 AS found FROM signature_assets WHERE r2_key = ? LIMIT 1").bind(key);
	}
	if (prefix === "branding/") {
		return db.prepare("SELECT 1 AS found FROM app_settings WHERE icon_key = ? LIMIT 1").bind(key);
	}
	return db
		.prepare(
			`SELECT 1 AS found FROM users WHERE avatar_key = ?
			 UNION ALL SELECT 1 AS found FROM mailboxes WHERE avatar_key = ?
			 LIMIT 1`,
		)
		.bind(key, key);
}

function parseObjectKeys(value: string): string[] {
	const parsed = JSON.parse(value) as string[];
	if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
		throw new Error("Deletion job contains invalid object keys");
	}
	return parsed;
}

function cutoff(now: Date, days: number): Date {
	return new Date(now.getTime() - days * DAY_MS);
}

function retryDelayMs(attempt: number): number {
	return Math.min(5 * 60 * 1_000 * 2 ** Math.max(0, attempt - 1), DAY_MS);
}

function deletionErrorCode(error: Error): string {
	if (/^E_[A-Z0-9_]{1,96}$/.test(error.message)) return error.message;
	return "E_STORAGE_DELETION_FAILED";
}

function unixSeconds(value: Date): number {
	return Math.floor(value.getTime() / 1_000);
}

function changed(result: { rowsAffected?: number; meta?: { changes?: number } }): number {
	return result.rowsAffected ?? result.meta?.changes ?? 0;
}
