import { newId } from "@/lib/ids";
import type {
	OperationalAlert,
	OperationalHealth,
	OperationalStatus,
	OperationalThresholds,
	QueueHealth,
	StorageSnapshot,
} from "./types";

const DAY_SECONDS = 24 * 60 * 60;
const SNAPSHOT_RETENTION_SECONDS = 400 * DAY_SECONDS;
const MAX_R2_LIST_PAGES = 900;

type CountRow = {
	accepted: number | null;
	delivered: number | null;
	failed: number | null;
	suppressed: number | null;
	unknownOutcome: number | null;
	pending: number | null;
	retrying: number | null;
	processing?: number | null;
	unresolved?: number | null;
	replaying?: number | null;
};

type SettingsRow = {
	queue_backlog_warning: number;
	queue_oldest_minutes_warning: number;
	delivery_failed_24h_warning: number;
	delivery_unknown_24h_warning: number;
	webhook_failed_24h_warning: number;
	reminder_failed_24h_warning: number;
	dead_letter_unresolved_warning: number;
	backup_stale_hours: number;
	d1_growth_percent_warning: number;
	r2_growth_percent_warning: number;
};

type SnapshotRow = {
	id: string;
	captured_at: number;
	d1_bytes: number;
	r2_object_count: number;
	r2_bytes: number;
	r2_scan_complete: number;
};

type BackupRow = {
	enabled: number;
	schedule_type: "daily" | "weekly" | "monthly";
	last_successful_at: number | null;
	last_failed_at: number | null;
};

type RestoreDrillRow = {
	verified_at: number;
	environment: "staging" | "production";
	source: "staging-script" | "manual";
};

type QueueSnapshotColumns = {
	count: number | null;
	bytes: number | null;
	oldestAt: number | null;
};

export const DEFAULT_OPERATIONAL_THRESHOLDS: OperationalThresholds = {
	queueBacklogWarning: 100,
	queueOldestMinutesWarning: 15,
	deliveryFailed24hWarning: 1,
	deliveryUnknown24hWarning: 1,
	webhookFailed24hWarning: 1,
	reminderFailed24hWarning: 1,
	deadLetterUnresolvedWarning: 1,
	backupStaleHours: 0,
	d1GrowthPercentWarning: 25,
	r2GrowthPercentWarning: 25,
};

export async function captureOperationalSnapshot(
	env: CloudflareEnv,
	now = new Date(),
): Promise<StorageSnapshot> {
	const [d1Bytes, r2, queues] = await Promise.all([
		getD1Size(env.DB),
		getR2Usage(env.BUCKET),
		getLiveQueueHealth(env),
	]);
	const capturedAt = Math.floor(now.getTime() / 1000);
	const inbound = toSnapshotColumns(queues[0]);
	const outbound = toSnapshotColumns(queues[1]);
	const webhook = toSnapshotColumns(queues[2]);
	const id = newId("ops");
	await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO operational_snapshots
			 (id, captured_at, d1_bytes, r2_object_count, r2_bytes, r2_scan_complete,
			  inbound_backlog_count, inbound_backlog_bytes, inbound_oldest_at,
			  outbound_backlog_count, outbound_backlog_bytes, outbound_oldest_at,
			  webhook_backlog_count, webhook_backlog_bytes, webhook_oldest_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).bind(
			id,
			capturedAt,
			d1Bytes,
			r2.objectCount,
			r2.bytes,
			r2.complete ? 1 : 0,
			inbound.count,
			inbound.bytes,
			inbound.oldestAt,
			outbound.count,
			outbound.bytes,
			outbound.oldestAt,
			webhook.count,
			webhook.bytes,
			webhook.oldestAt,
		),
		env.DB.prepare("DELETE FROM operational_snapshots WHERE captured_at < ?").bind(
			capturedAt - SNAPSHOT_RETENTION_SECONDS,
		),
	]);
	return {
		id,
		capturedAt: now.toISOString(),
		d1Bytes,
		r2ObjectCount: r2.objectCount,
		r2Bytes: r2.bytes,
		r2ScanComplete: r2.complete,
	};
}

export async function getOperationalHealth(
	env: CloudflareEnv,
	now = new Date(),
): Promise<OperationalHealth> {
	const cutoff = Math.floor(now.getTime() / 1000) - DAY_SECONDS;
	const [
		settingsRow,
		queues,
		delivery,
		deadLetters,
		webhooks,
		reminders,
		snapshotsResult,
		backup,
		restoreDrill,
	] = await Promise.all([
		getSettingsRow(env.DB),
		getLiveQueueHealth(env),
		env.DB.prepare(
			`SELECT
			 SUM(CASE WHEN direction = 'outbound' AND COALESCE(delivery_updated_at, created_at) >= ? AND delivery_status = 'accepted' THEN 1 ELSE 0 END) accepted,
			 SUM(CASE WHEN direction = 'outbound' AND COALESCE(delivery_updated_at, created_at) >= ? AND delivery_status = 'delivered' THEN 1 ELSE 0 END) delivered,
			 SUM(CASE WHEN direction = 'outbound' AND COALESCE(delivery_updated_at, created_at) >= ? AND delivery_status = 'failed' THEN 1 ELSE 0 END) failed,
			 SUM(CASE WHEN direction = 'outbound' AND COALESCE(delivery_updated_at, created_at) >= ? AND delivery_status = 'suppressed' THEN 1 ELSE 0 END) suppressed,
			 SUM(CASE WHEN direction = 'outbound' AND COALESCE(delivery_updated_at, created_at) >= ? AND delivery_status = 'unknown' THEN 1 ELSE 0 END) unknownOutcome,
			 (SELECT COUNT(*) FROM outbound_jobs WHERE status IN ('scheduled', 'queued', 'sending')) pending,
			 (SELECT COUNT(*) FROM outbound_jobs WHERE attempt_count > 0 AND status IN ('scheduled', 'queued', 'sending')) retrying
			 FROM messages`,
		)
			.bind(cutoff, cutoff, cutoff, cutoff, cutoff)
			.first<CountRow>(),
		env.DB.prepare(
			`SELECT
			 SUM(CASE WHEN status = 'unresolved' THEN 1 ELSE 0 END) unresolved,
			 SUM(CASE WHEN status = 'replaying' THEN 1 ELSE 0 END) replaying
			 FROM dead_letter_events`,
		).first<CountRow>(),
		env.DB.prepare(
			`SELECT
			 SUM(CASE WHEN status IN ('pending', 'delivering') THEN 1 ELSE 0 END) pending,
			 SUM(CASE WHEN attempts > 1 AND status IN ('pending', 'delivering') THEN 1 ELSE 0 END) retrying,
			 SUM(CASE WHEN status = 'failed' AND COALESCE(last_attempt_at, created_at) >= ? THEN 1 ELSE 0 END) failed
			 FROM webhook_deliveries`,
		)
			.bind(cutoff)
			.first<CountRow>(),
		env.DB.prepare(
			`SELECT
			 SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) pending,
			 SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) processing,
			 SUM(CASE WHEN attempt_count > 0 AND status IN ('scheduled', 'processing') THEN 1 ELSE 0 END) retrying,
			 SUM(CASE WHEN status = 'failed' AND updated_at >= ? THEN 1 ELSE 0 END) failed
			 FROM calendar_reminders`,
		)
			.bind(cutoff)
			.first<CountRow>(),
		env.DB.prepare(
			`SELECT id, captured_at, d1_bytes, r2_object_count, r2_bytes, r2_scan_complete
			 FROM operational_snapshots ORDER BY captured_at DESC LIMIT 2`,
		).all<SnapshotRow>(),
		env.DB.prepare(
			`SELECT bs.enabled, bs.schedule_type,
			 (SELECT MAX(completed_at) FROM backups WHERE status = 'completed') last_successful_at,
			 (SELECT MAX(completed_at) FROM backups WHERE status = 'failed') last_failed_at
			 FROM backup_settings bs WHERE bs.id = 'default'`,
		).first<BackupRow>(),
		env.DB.prepare(
			`SELECT verified_at, environment, source FROM restore_drill_records
			 WHERE d1_verified = 1 AND r2_verified = 1 AND rollback_verified = 1
			   AND sessions_invalidated = 1 AND cleanup_verified = 1
			 ORDER BY verified_at DESC LIMIT 1`,
		).first<RestoreDrillRow>(),
	]);

	const thresholds = settingsFromRow(settingsRow);
	const latest = snapshotsResult.results[0] ? snapshotFromRow(snapshotsResult.results[0]) : null;
	const previous = snapshotsResult.results[1] ? snapshotFromRow(snapshotsResult.results[1]) : null;
	const growth = latest
		? {
				d1Bytes: latest.d1Bytes - (previous?.d1Bytes ?? latest.d1Bytes),
				d1Percent: growthPercent(latest.d1Bytes, previous?.d1Bytes),
				r2Bytes: latest.r2Bytes - (previous?.r2Bytes ?? latest.r2Bytes),
				r2Percent: growthPercent(latest.r2Bytes, previous?.r2Bytes),
				since: previous?.capturedAt ?? null,
			}
		: null;
	const staleAfterHours = backupStaleHours(backup, thresholds);
	const lastSuccessfulAt = toIso(backup?.last_successful_at);
	const isStale =
		!backup?.last_successful_at ||
		Math.floor(now.getTime() / 1000) - backup.last_successful_at > staleAfterHours * 60 * 60;
	const alerts = buildAlerts({
		now,
		queues,
		thresholds,
		delivery,
		deadLetters,
		webhooks,
		reminders,
		latest,
		growth,
		isBackupStale: isStale,
	});
	return {
		status: overallStatus(alerts),
		generatedAt: now.toISOString(),
		alerts,
		queues,
		delivery: {
			accepted24h: count(delivery?.accepted),
			delivered24h: count(delivery?.delivered),
			failed24h: count(delivery?.failed),
			suppressed24h: count(delivery?.suppressed),
			unknown24h: count(delivery?.unknownOutcome),
			pendingJobs: count(delivery?.pending),
			retryingJobs: count(delivery?.retrying),
		},
		deadLetters: {
			unresolved: count(deadLetters?.unresolved),
			replaying: count(deadLetters?.replaying),
		},
		webhooks: {
			pending: count(webhooks?.pending),
			retrying: count(webhooks?.retrying),
			failed24h: count(webhooks?.failed),
		},
		reminders: {
			scheduled: count(reminders?.pending),
			processing: count(reminders?.processing),
			retrying: count(reminders?.retrying),
			failed24h: count(reminders?.failed),
		},
		storage: { latest, growth },
		backup: {
			enabled: backup?.enabled === 1,
			scheduleType: backup?.schedule_type ?? "daily",
			lastSuccessfulAt,
			lastFailedAt: toIso(backup?.last_failed_at),
			staleAfterHours,
			isStale,
		},
		restoreDrill: restoreDrill
			? {
					lastVerifiedAt: toIso(restoreDrill.verified_at),
					environment: restoreDrill.environment,
					source: restoreDrill.source,
				}
			: null,
		thresholds,
	};
}

export async function updateOperationalThresholds(
	db: D1Database,
	thresholds: OperationalThresholds,
	now = new Date(),
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO operational_settings
		 (id, queue_backlog_warning, queue_oldest_minutes_warning,
		  delivery_failed_24h_warning, delivery_unknown_24h_warning,
		  webhook_failed_24h_warning, reminder_failed_24h_warning,
		  dead_letter_unresolved_warning, backup_stale_hours,
		  d1_growth_percent_warning, r2_growth_percent_warning, updated_at)
		 VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		 queue_backlog_warning = excluded.queue_backlog_warning,
		 queue_oldest_minutes_warning = excluded.queue_oldest_minutes_warning,
		 delivery_failed_24h_warning = excluded.delivery_failed_24h_warning,
		 delivery_unknown_24h_warning = excluded.delivery_unknown_24h_warning,
		 webhook_failed_24h_warning = excluded.webhook_failed_24h_warning,
		 reminder_failed_24h_warning = excluded.reminder_failed_24h_warning,
		 dead_letter_unresolved_warning = excluded.dead_letter_unresolved_warning,
		 backup_stale_hours = excluded.backup_stale_hours,
		 d1_growth_percent_warning = excluded.d1_growth_percent_warning,
		 r2_growth_percent_warning = excluded.r2_growth_percent_warning,
		 updated_at = excluded.updated_at`,
		)
		.bind(
			thresholds.queueBacklogWarning,
			thresholds.queueOldestMinutesWarning,
			thresholds.deliveryFailed24hWarning,
			thresholds.deliveryUnknown24hWarning,
			thresholds.webhookFailed24hWarning,
			thresholds.reminderFailed24hWarning,
			thresholds.deadLetterUnresolvedWarning,
			thresholds.backupStaleHours,
			thresholds.d1GrowthPercentWarning,
			thresholds.r2GrowthPercentWarning,
			Math.floor(now.getTime() / 1000),
		)
		.run();
}

async function getLiveQueueHealth(env: CloudflareEnv): Promise<QueueHealth[]> {
	return Promise.all([
		getQueueHealth("inbound", env.INBOUND_QUEUE),
		getQueueHealth("outbound", env.OUTBOUND_QUEUE),
		getQueueHealth("webhook", env.WEBHOOK_QUEUE),
	]);
}

async function getQueueHealth(name: QueueHealth["name"], queue: Queue): Promise<QueueHealth> {
	try {
		const metrics = await queue.metrics();
		return {
			name,
			available: true,
			backlogCount: metrics.backlogCount,
			backlogBytes: metrics.backlogBytes,
			oldestMessageAt: metrics.oldestMessageTimestamp?.toISOString() ?? null,
		};
	} catch {
		return {
			name,
			available: false,
			backlogCount: null,
			backlogBytes: null,
			oldestMessageAt: null,
		};
	}
}

async function getD1Size(db: D1Database): Promise<number> {
	const result = await db.prepare("SELECT 1 AS health_check").all<{ health_check: number }>();
	return result.meta.size_after;
}

async function getR2Usage(bucket: R2Bucket): Promise<{
	objectCount: number;
	bytes: number;
	complete: boolean;
}> {
	let cursor: string | undefined;
	let objectCount = 0;
	let bytes = 0;
	for (let page = 0; page < MAX_R2_LIST_PAGES; page += 1) {
		const result = await bucket.list({ limit: 1_000, ...(cursor ? { cursor } : {}) });
		objectCount += result.objects.length;
		for (const object of result.objects) bytes += object.size;
		if (!result.truncated) return { objectCount, bytes, complete: true };
		cursor = result.cursor;
		if (!cursor) return { objectCount, bytes, complete: false };
	}
	return { objectCount, bytes, complete: false };
}

async function getSettingsRow(db: D1Database): Promise<SettingsRow | null> {
	return db.prepare("SELECT * FROM operational_settings WHERE id = 'default'").first<SettingsRow>();
}

function settingsFromRow(row: SettingsRow | null): OperationalThresholds {
	if (!row) return DEFAULT_OPERATIONAL_THRESHOLDS;
	return {
		queueBacklogWarning: row.queue_backlog_warning,
		queueOldestMinutesWarning: row.queue_oldest_minutes_warning,
		deliveryFailed24hWarning: row.delivery_failed_24h_warning,
		deliveryUnknown24hWarning: row.delivery_unknown_24h_warning,
		webhookFailed24hWarning: row.webhook_failed_24h_warning,
		reminderFailed24hWarning: row.reminder_failed_24h_warning,
		deadLetterUnresolvedWarning: row.dead_letter_unresolved_warning,
		backupStaleHours: row.backup_stale_hours,
		d1GrowthPercentWarning: row.d1_growth_percent_warning,
		r2GrowthPercentWarning: row.r2_growth_percent_warning,
	};
}

function snapshotFromRow(row: SnapshotRow): StorageSnapshot {
	return {
		id: row.id,
		capturedAt: new Date(row.captured_at * 1_000).toISOString(),
		d1Bytes: row.d1_bytes,
		r2ObjectCount: row.r2_object_count,
		r2Bytes: row.r2_bytes,
		r2ScanComplete: row.r2_scan_complete === 1,
	};
}

function buildAlerts(input: {
	now: Date;
	queues: QueueHealth[];
	thresholds: OperationalThresholds;
	delivery: CountRow | null;
	deadLetters: CountRow | null;
	webhooks: CountRow | null;
	reminders: CountRow | null;
	latest: StorageSnapshot | null;
	growth: OperationalHealth["storage"]["growth"];
	isBackupStale: boolean;
}): OperationalAlert[] {
	const alerts: OperationalAlert[] = [];
	for (const queue of input.queues) {
		if (!queue.available) {
			alerts.push({
				code: `QUEUE_METRICS_UNAVAILABLE_${queue.name.toUpperCase()}`,
				severity: "warning",
				message: `${queue.name} queue metrics are temporarily unavailable.`,
			});
			continue;
		}
		if (count(queue.backlogCount) >= input.thresholds.queueBacklogWarning) {
			alerts.push({
				code: `QUEUE_BACKLOG_${queue.name.toUpperCase()}`,
				severity: "warning",
				message: `${queue.name} queue has ${queue.backlogCount} messages waiting.`,
			});
		}
		if (queue.oldestMessageAt) {
			const ageMinutes = (input.now.getTime() - new Date(queue.oldestMessageAt).getTime()) / 60_000;
			if (ageMinutes >= input.thresholds.queueOldestMinutesWarning) {
				alerts.push({
					code: `QUEUE_AGE_${queue.name.toUpperCase()}`,
					severity: "critical",
					message: `${queue.name} queue's oldest message is ${Math.floor(ageMinutes)} minutes old.`,
				});
			}
		}
	}
	addCountAlert(
		alerts,
		"DELIVERY_FAILED",
		"critical",
		count(input.delivery?.failed),
		input.thresholds.deliveryFailed24hWarning,
		"outbound deliveries failed in the last 24 hours",
	);
	addCountAlert(
		alerts,
		"DELIVERY_UNKNOWN",
		"critical",
		count(input.delivery?.unknownOutcome),
		input.thresholds.deliveryUnknown24hWarning,
		"outbound deliveries have an unknown outcome in the last 24 hours",
	);
	addCountAlert(
		alerts,
		"DEAD_LETTERS_UNRESOLVED",
		"critical",
		count(input.deadLetters?.unresolved),
		input.thresholds.deadLetterUnresolvedWarning,
		"dead-letter events are unresolved",
	);
	addCountAlert(
		alerts,
		"WEBHOOK_FAILED",
		"warning",
		count(input.webhooks?.failed),
		input.thresholds.webhookFailed24hWarning,
		"webhook deliveries failed in the last 24 hours",
	);
	addCountAlert(
		alerts,
		"REMINDER_FAILED",
		"warning",
		count(input.reminders?.failed),
		input.thresholds.reminderFailed24hWarning,
		"reminders failed in the last 24 hours",
	);
	if (input.isBackupStale) {
		alerts.push({
			code: "BACKUP_STALE",
			severity: "critical",
			message: "No fresh successful database backup is available.",
		});
	}
	if (!input.latest) {
		alerts.push({
			code: "STORAGE_SNAPSHOT_MISSING",
			severity: "warning",
			message: "Storage usage has not been measured yet.",
		});
	} else if (!input.latest.r2ScanComplete) {
		alerts.push({
			code: "R2_SCAN_INCOMPLETE",
			severity: "warning",
			message: "The latest R2 usage scan reached its safety limit and is a lower bound.",
		});
	}
	if (
		input.growth?.d1Percent !== null &&
		input.growth &&
		input.growth.d1Percent >= input.thresholds.d1GrowthPercentWarning
	) {
		alerts.push({
			code: "D1_GROWTH",
			severity: "warning",
			message: `D1 grew ${input.growth.d1Percent.toFixed(1)}% since the previous snapshot.`,
		});
	}
	if (
		input.growth?.r2Percent !== null &&
		input.growth &&
		input.growth.r2Percent >= input.thresholds.r2GrowthPercentWarning
	) {
		alerts.push({
			code: "R2_GROWTH",
			severity: "warning",
			message: `R2 grew ${input.growth.r2Percent.toFixed(1)}% since the previous snapshot.`,
		});
	}
	return alerts;
}

function addCountAlert(
	alerts: OperationalAlert[],
	code: string,
	severity: OperationalAlert["severity"],
	value: number,
	threshold: number,
	label: string,
): void {
	if (value < threshold) return;
	alerts.push({ code, severity, message: `${value} ${label}.` });
}

function overallStatus(alerts: OperationalAlert[]): OperationalStatus {
	if (alerts.some((alert) => alert.severity === "critical")) return "critical";
	return alerts.length > 0 ? "warning" : "healthy";
}

function backupStaleHours(backup: BackupRow | null, thresholds: OperationalThresholds): number {
	if (thresholds.backupStaleHours > 0) return thresholds.backupStaleHours;
	if (!backup?.enabled) return 168;
	if (backup.schedule_type === "weekly") return 192;
	if (backup.schedule_type === "monthly") return 840;
	return 36;
}

function growthPercent(current: number, previous: number | undefined): number | null {
	if (previous === undefined || previous <= 0) return null;
	return ((current - previous) / previous) * 100;
}

function toSnapshotColumns(queue: QueueHealth): QueueSnapshotColumns {
	return {
		count: queue.backlogCount,
		bytes: queue.backlogBytes,
		oldestAt: queue.oldestMessageAt
			? Math.floor(new Date(queue.oldestMessageAt).getTime() / 1_000)
			: null,
	};
}

function count(value: number | null | undefined): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toIso(value: number | null | undefined): string | null {
	return typeof value === "number" ? new Date(value * 1_000).toISOString() : null;
}
