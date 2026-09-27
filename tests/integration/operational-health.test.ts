import { beforeEach, describe, expect, it } from "vitest";
import {
	captureOperationalSnapshot,
	getOperationalHealth,
	updateOperationalThresholds,
} from "@/lib/operations/health";
import type { OperationalThresholds } from "@/lib/operations/types";
import { integrationEnv } from "./bindings";
import { createMailEnv, fixtureIds, resetIntegrationState, seedMailboxWorld } from "./fixtures";

const now = new Date("2026-09-15T12:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1_000);

beforeEach(async () => {
	await resetIntegrationState();
	await seedMailboxWorld();
});

describe("operational health", () => {
	it("aggregates queue, delivery, retry, storage, backup, and drill health without content", async () => {
		await seedOperationalWorld();
		const env = createOperationsEnv({
			inbound: { backlogCount: 2, backlogBytes: 200 },
			outbound: {
				backlogCount: 12,
				backlogBytes: 1_200,
				oldestMessageTimestamp: new Date(now.getTime() - 20 * 60_000),
			},
			webhook: { backlogCount: 1, backlogBytes: 100 },
		});
		const health = await getOperationalHealth(env, now);

		expect(health.status).toBe("critical");
		expect(health.queues.find((queue) => queue.name === "outbound")?.backlogCount).toBe(12);
		expect(health.delivery).toMatchObject({
			accepted24h: 1,
			failed24h: 1,
			suppressed24h: 1,
			unknown24h: 1,
			pendingJobs: 1,
			retryingJobs: 1,
		});
		expect(health.deadLetters.unresolved).toBe(1);
		expect(health.webhooks).toMatchObject({ pending: 1, retrying: 1, failed24h: 1 });
		expect(health.reminders).toMatchObject({ scheduled: 1, retrying: 1, failed24h: 1 });
		expect(health.storage.latest).toMatchObject({ d1Bytes: 125_000, r2Bytes: 250_000 });
		expect(health.storage.growth).toMatchObject({ d1Percent: 25, r2Percent: 25 });
		expect(health.backup.isStale).toBe(true);
		expect(health.restoreDrill).toMatchObject({ environment: "staging", source: "staging-script" });
		expect(health.alerts.map((alert) => alert.code)).toEqual(
			expect.arrayContaining([
				"QUEUE_BACKLOG_OUTBOUND",
				"QUEUE_AGE_OUTBOUND",
				"DELIVERY_FAILED",
				"DELIVERY_UNKNOWN",
				"DEAD_LETTERS_UNRESOLVED",
				"BACKUP_STALE",
				"D1_GROWTH",
				"R2_GROWTH",
			]),
		);
		const serialized = JSON.stringify(health);
		expect(serialized).not.toContain("Sensitive subject");
		expect(serialized).not.toContain("owner@primary.test");
		expect(serialized).not.toContain("webhook-secret");
	});

	it("captures binding-backed D1, R2, and queue metadata", async () => {
		await integrationEnv.BUCKET.put("usage/a.bin", new Uint8Array(10));
		await integrationEnv.BUCKET.put("usage/b.bin", new Uint8Array(25));
		const env = createOperationsEnv({
			inbound: { backlogCount: 3, backlogBytes: 30 },
			outbound: { backlogCount: 4, backlogBytes: 40 },
			webhook: { backlogCount: 5, backlogBytes: 50 },
		});
		const snapshot = await captureOperationalSnapshot(env, now);
		const row = await integrationEnv.DB.prepare(
			`SELECT d1_bytes, r2_object_count, r2_bytes, r2_scan_complete,
			 inbound_backlog_count, outbound_backlog_count, webhook_backlog_count
			 FROM operational_snapshots WHERE id = ?`,
		)
			.bind(snapshot.id)
			.first<{
				d1_bytes: number;
				r2_object_count: number;
				r2_bytes: number;
				r2_scan_complete: number;
				inbound_backlog_count: number;
				outbound_backlog_count: number;
				webhook_backlog_count: number;
			}>();

		expect(snapshot.d1Bytes).toBeGreaterThan(0);
		expect(snapshot).toMatchObject({ r2ObjectCount: 2, r2Bytes: 35, r2ScanComplete: true });
		expect(row).toMatchObject({
			r2_object_count: 2,
			r2_bytes: 35,
			r2_scan_complete: 1,
			inbound_backlog_count: 3,
			outbound_backlog_count: 4,
			webhook_backlog_count: 5,
		});
	});

	it("upserts validated threshold values after a legacy restore removed the singleton", async () => {
		const thresholds: OperationalThresholds = {
			queueBacklogWarning: 200,
			queueOldestMinutesWarning: 30,
			deliveryFailed24hWarning: 2,
			deliveryUnknown24hWarning: 2,
			webhookFailed24hWarning: 3,
			reminderFailed24hWarning: 3,
			deadLetterUnresolvedWarning: 2,
			backupStaleHours: 72,
			d1GrowthPercentWarning: 20,
			r2GrowthPercentWarning: 30,
		};
		await updateOperationalThresholds(integrationEnv.DB, thresholds, now);
		const health = await getOperationalHealth(createOperationsEnv(), now);
		expect(health.thresholds).toEqual(thresholds);
	});
});

async function seedOperationalWorld(): Promise<void> {
	const db = integrationEnv.DB;
	const messageStatuses = ["accepted", "failed", "suppressed", "unknown"] as const;
	await db.batch([
		...messageStatuses.map((status) =>
			db
				.prepare(
					`INSERT INTO messages
				 (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status,
				  delivery_status, created_at)
				 VALUES (?, ?, ?, 'outbound', 'owner@primary.test', 'recipient@example.test',
				  'Sensitive subject', 'sent', ?, ?)`,
				)
				.bind(
					`message_${status}`,
					fixtureIds.owner,
					fixtureIds.localMailbox,
					status,
					nowSeconds - 60,
				),
		),
		db
			.prepare(
				`INSERT INTO outbound_jobs
			 (id, user_id, message_id, status, payload, attempt_count, created_at, updated_at)
			 VALUES ('job_retry', ?, 'message_accepted', 'queued', '{"private":"payload"}', 2, ?, ?)`,
			)
			.bind(fixtureIds.owner, nowSeconds - 60, nowSeconds - 60),
		db
			.prepare(
				`INSERT INTO dead_letter_events
			 (id, source_queue, dead_letter_queue, queue_message_id, payload, diagnostic_code,
			  attempt_count, status, message_created_at, created_at, updated_at)
			 VALUES ('dead_ops', 'outbound', 'outbound-dlq', 'queue-private', '{"private":"payload"}',
			  'E_TEST', 4, 'unresolved', ?, ?, ?)`,
			)
			.bind(nowSeconds - 60, nowSeconds - 60, nowSeconds - 60),
		db
			.prepare(
				`INSERT INTO webhooks (id, user_id, url, secret, events, enabled, created_at)
			 VALUES ('webhook_ops', ?, 'https://example.test/hook', 'webhook-secret', '[]', 1, ?)`,
			)
			.bind(fixtureIds.owner, nowSeconds - 60),
		db
			.prepare(
				`INSERT INTO webhook_deliveries
			 (id, webhook_id, event_type, payload, status, attempts, created_at)
			 VALUES ('webhook_pending', 'webhook_ops', 'message.outbound', '{}', 'pending', 2, ?)`,
			)
			.bind(nowSeconds - 60),
		db
			.prepare(
				`INSERT INTO webhook_deliveries
			 (id, webhook_id, event_type, payload, status, attempts, created_at)
			 VALUES ('webhook_failed', 'webhook_ops', 'message.failed', '{}', 'failed', 4, ?)`,
			)
			.bind(nowSeconds - 60),
		db
			.prepare(
				`INSERT INTO calendar_tasks
			 (id, user_id, title, status, priority, created_at, updated_at)
			 VALUES ('task_ops', ?, 'Private task', 'open', 'high', ?, ?)`,
			)
			.bind(fixtureIds.owner, nowSeconds - 60, nowSeconds - 60),
		db
			.prepare(
				`INSERT INTO calendar_reminders
			 (id, user_id, task_id, title, remind_at, status, attempt_count, created_at, updated_at)
			 VALUES ('reminder_pending', ?, 'task_ops', 'Private reminder', ?, 'scheduled', 2, ?, ?)`,
			)
			.bind(fixtureIds.owner, nowSeconds + 600, nowSeconds - 60, nowSeconds - 60),
		db
			.prepare(
				`INSERT INTO calendar_reminders
			 (id, user_id, task_id, title, remind_at, status, attempt_count, created_at, updated_at)
			 VALUES ('reminder_failed', ?, 'task_ops', 'Private reminder', ?, 'failed', 3, ?, ?)`,
			)
			.bind(fixtureIds.owner, nowSeconds - 600, nowSeconds - 60, nowSeconds - 60),
		db
			.prepare(
				`INSERT INTO backup_settings
			 (id, enabled, schedule_type, retention_enabled, retention_days, updated_at)
			 VALUES ('default', 1, 'daily', 0, 30, ?)`,
			)
			.bind(nowSeconds - 60),
		db
			.prepare(
				`INSERT INTO backups (id, status, trigger, created_at, completed_at)
			 VALUES ('backup_old', 'completed', 'scheduled', ?, ?)`,
			)
			.bind(nowSeconds - 3 * 86_400, nowSeconds - 3 * 86_400),
		db
			.prepare(
				`INSERT INTO operational_settings
			 (id, queue_backlog_warning, queue_oldest_minutes_warning, delivery_failed_24h_warning,
			  delivery_unknown_24h_warning, webhook_failed_24h_warning, reminder_failed_24h_warning,
			  dead_letter_unresolved_warning, backup_stale_hours, d1_growth_percent_warning,
			  r2_growth_percent_warning, updated_at)
			 VALUES ('default', 10, 15, 1, 1, 1, 1, 1, 36, 20, 20, ?)`,
			)
			.bind(nowSeconds - 60),
		db
			.prepare(
				`INSERT INTO operational_snapshots
			 (id, captured_at, d1_bytes, r2_object_count, r2_bytes, r2_scan_complete)
			 VALUES ('snapshot_previous', ?, 100000, 10, 200000, 1)`,
			)
			.bind(nowSeconds - 86_400),
		db
			.prepare(
				`INSERT INTO operational_snapshots
			 (id, captured_at, d1_bytes, r2_object_count, r2_bytes, r2_scan_complete)
			 VALUES ('snapshot_latest', ?, 125000, 12, 250000, 1)`,
			)
			.bind(nowSeconds - 60),
		db
			.prepare(
				`INSERT INTO restore_drill_records
			 (id, environment, source, verified_at, d1_verified, r2_verified, rollback_verified,
			  sessions_invalidated, cleanup_verified)
			 VALUES ('drill_ops', 'staging', 'staging-script', ?, 1, 1, 1, 1, 1)`,
			)
			.bind(nowSeconds - 86_400),
	]);
}

function createOperationsEnv(metrics?: {
	inbound: QueueMetricFixture;
	outbound: QueueMetricFixture;
	webhook: QueueMetricFixture;
}): CloudflareEnv {
	const empty = { backlogCount: 0, backlogBytes: 0 };
	return createMailEnv({
		INBOUND_QUEUE: queueWithMetrics(metrics?.inbound ?? empty),
		OUTBOUND_QUEUE: queueWithMetrics(metrics?.outbound ?? empty),
		WEBHOOK_QUEUE: queueWithMetrics(metrics?.webhook ?? empty),
	});
}

type QueueMetricFixture = {
	backlogCount: number;
	backlogBytes: number;
	oldestMessageTimestamp?: Date;
};

function queueWithMetrics(metrics: QueueMetricFixture): Queue {
	return { metrics: async () => metrics } as Queue;
}
