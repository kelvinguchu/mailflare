import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { and, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { backups } from "@/db/schema";
import { createBackupBundle } from "./bundle";
import { deleteBackupBundle } from "./objects";
import { createScheduledBackupIfDue, getBackupSettings } from "./service";
import type { BackupWorkflowParams } from "./types";

export class DatabaseBackupWorkflow extends WorkflowEntrypoint<CloudflareEnv, BackupWorkflowParams> {
	async run(event: Readonly<WorkflowEvent<BackupWorkflowParams>>, step: WorkflowStep) {
		let backupId: string | null | undefined = event.payload?.backupId;
		if (!backupId) {
			backupId = await step.do("Check backup schedule", async () =>
				createScheduledBackupIfDue(this.env, event.timestamp),
			);
		}
		if (!backupId) {
			const retention = await step.do("Delete expired backups", async () => this.deleteExpiredBackups());
			return { skipped: true, ...retention };
		}

		try {
			await step.do("Mark backup running", async () => {
				await getDb(this.env)
					.update(backups)
					.set({ status: "running", startedAt: new Date() })
					.where(eq(backups.id, backupId));
			});

			const stored = await step.do(
				"Store backup bundle in R2",
				{ timeout: "30 minutes" },
				async () => {
					const bundle = await createBackupBundle(this.env, backupId, {
						purpose: "database-backup",
					});
					return {
						filename: bundle.filename,
						r2Key: bundle.r2Key,
						size: bundle.totalSize,
						manifestSize: bundle.manifestSize,
						objectCount: bundle.objectCount,
						objectSize: bundle.objectSize,
					};
				},
			);

			await step.do("Complete backup", async () => {
				await getDb(this.env)
					.update(backups)
					.set({
						status: "completed",
						filename: stored.filename,
						r2Key: stored.r2Key,
						size: stored.size,
						completedAt: new Date(),
						error: null,
					})
					.where(eq(backups.id, backupId));
			});

			await step.do("Delete expired backups", async () => this.deleteExpiredBackups());
			return { backupId, ...stored };
		} catch (error) {
			const message = error instanceof Error ? error.message : "Backup failed";
			await getDb(this.env)
				.update(backups)
				.set({ status: "failed", error: message, completedAt: new Date() })
				.where(eq(backups.id, backupId));
			throw error;
		}
	}

	private async deleteExpiredBackups(): Promise<{ deleted: number }> {
		const settings = await getBackupSettings(this.env);
		if (!settings?.retentionEnabled) return { deleted: 0 };
		const cutoff = new Date(Date.now() - settings.retentionDays * 86_400_000);
		const db = getDb(this.env);
		const expired = await db
			.select()
			.from(backups)
			.where(
				and(
					lt(backups.createdAt, cutoff),
					inArray(backups.status, ["completed", "failed"]),
				),
			);
		for (const backup of expired) {
			await deleteBackupBundle(this.env.BUCKET, backup.id);
			await db.delete(backups).where(eq(backups.id, backup.id));
		}
		return { deleted: expired.length };
	}
}
