import { and, desc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { backups, backupSettings } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { BackupScheduleType } from "./types";
import {
	BACKUP_SETTINGS_ID,
	getBackupWorkflowBinding,
	getScheduledBackupRecordId,
	getUtcDayBounds,
	isBackupDue,
} from "./utils";

export async function getBackupSettings(env: CloudflareEnv) {
	const db = getDb(env);
	const [settings] = await db
		.select()
		.from(backupSettings)
		.where(eq(backupSettings.id, BACKUP_SETTINGS_ID))
		.limit(1);
	return settings;
}

export async function listBackups(env: CloudflareEnv) {
	return getDb(env).select().from(backups).orderBy(desc(backups.createdAt)).limit(100);
}

export async function createBackupRecord(
	env: CloudflareEnv,
	trigger: "manual" | "scheduled",
	createdByUserId?: string,
) {
	const id = newId("bak");
	await getDb(env).insert(backups).values({
		id,
		trigger,
		createdByUserId: createdByUserId ?? null,
	});
	return id;
}

export async function createScheduledBackupIfDue(env: CloudflareEnv, now: Date): Promise<string | null> {
	const settings = await getBackupSettings(env);
	if (!settings?.enabled) return null;
	if (!isBackupDue(settings.scheduleType as BackupScheduleType, settings.scheduleValue, now)) return null;

	const { start, end } = getUtcDayBounds(now);
	const existing = await getDb(env)
		.select({ id: backups.id })
		.from(backups)
		.where(
			and(
				eq(backups.trigger, "scheduled"),
				gte(backups.createdAt, new Date(start)),
				lt(backups.createdAt, new Date(end)),
			),
		)
		.limit(1);
	if (existing.length) return null;

	// The UTC date is the idempotency key. If overlapping scheduler invocations
	// race after the check above, D1's primary key allows only one record.
	const id = getScheduledBackupRecordId(now);
	const inserted = await getDb(env)
		.insert(backups)
		.values({
			id,
			trigger: "scheduled",
			createdAt: now,
		})
		.onConflictDoNothing({ target: backups.id })
		.returning({ id: backups.id });
	return inserted[0]?.id ?? null;
}

export async function startBackupWorkflow(env: CloudflareEnv, backupId: string): Promise<void> {
	try {
		await getBackupWorkflowBinding(env).create({
			id: `database-backup-${backupId}`,
			params: { backupId, force: true },
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to start backup";
		await getDb(env)
			.update(backups)
			.set({ status: "failed", error: message, completedAt: new Date() })
			.where(eq(backups.id, backupId));
		throw error;
	}
}

export async function updateBackupSettings(
	env: CloudflareEnv,
	input: {
		enabled: boolean;
		scheduleType: BackupScheduleType;
		scheduleValue: number | null;
		retentionEnabled: boolean;
		retentionDays: number;
	},
) {
	await getDb(env)
		.update(backupSettings)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(backupSettings.id, BACKUP_SETTINGS_ID));
}

export async function deleteBackup(env: CloudflareEnv, id: string): Promise<boolean> {
	const db = getDb(env);
	const [backup] = await db.select().from(backups).where(eq(backups.id, id)).limit(1);
	if (!backup) return false;
	if (backup.status === "queued" || backup.status === "running") {
		throw new Error("A backup in progress cannot be deleted");
	}
	if (backup.r2Key) await env.BUCKET.delete(backup.r2Key);
	await db.delete(backups).where(eq(backups.id, id));
	return true;
}
