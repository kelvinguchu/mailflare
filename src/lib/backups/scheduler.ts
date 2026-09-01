import {
	createScheduledBackupIfDue,
	startBackupWorkflow,
} from "./service";

export type ScheduledBackupResult =
	| { outcome: "skipped" }
	| { outcome: "queued"; backupId: string };

export async function runScheduledBackup(
	env: CloudflareEnv,
	scheduledTime: Date,
): Promise<ScheduledBackupResult> {
	const timestamp = scheduledTime.toISOString();
	const backupId = await createScheduledBackupIfDue(env, scheduledTime);
	if (!backupId) {
		console.info({
			event: "database_backup_schedule",
			outcome: "skipped",
			scheduledTime: timestamp,
		});
		return { outcome: "skipped" };
	}

	try {
		await startBackupWorkflow(env, backupId);
		console.info({
			event: "database_backup_schedule",
			outcome: "queued",
			backupId,
			scheduledTime: timestamp,
		});
		return { outcome: "queued", backupId };
	} catch (error) {
		console.error({
			event: "database_backup_schedule",
			outcome: "failed",
			backupId,
			scheduledTime: timestamp,
			error: error instanceof Error ? error.message : "Failed to start backup",
		});
		throw error;
	}
}
