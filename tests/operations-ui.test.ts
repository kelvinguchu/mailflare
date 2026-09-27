import { describe, expect, it } from "vitest";
import {
	OperationsRequestError,
	describeOperationsError,
	formatDuration,
	getAlertLink,
	getDeliveryRate,
	getDeliverySegments,
	getOldestQueueMinutes,
	getTotalBacklog,
	isRecentAuthenticationError,
	queueTone,
	validateThresholds,
} from "../src/app/(admin)/operations/utils";
import { DEFAULT_OPERATIONAL_THRESHOLDS } from "../src/lib/operations/health";
import type { OperationalHealth } from "../src/lib/operations/types";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function health(overrides: Partial<OperationalHealth> = {}): OperationalHealth {
	return {
		status: "healthy",
		generatedAt: NOW.toISOString(),
		alerts: [],
		queues: [
			{
				name: "inbound",
				available: true,
				backlogCount: 3,
				backlogBytes: 2_048,
				oldestMessageAt: "2026-09-15T11:58:00.000Z",
			},
			{
				name: "outbound",
				available: true,
				backlogCount: 0,
				backlogBytes: 0,
				oldestMessageAt: null,
			},
			{
				name: "webhook",
				available: false,
				backlogCount: null,
				backlogBytes: null,
				oldestMessageAt: null,
			},
		],
		delivery: {
			accepted24h: 2,
			delivered24h: 90,
			failed24h: 5,
			suppressed24h: 3,
			unknown24h: 0,
			pendingJobs: 1,
			retryingJobs: 0,
		},
		deadLetters: { unresolved: 0, replaying: 0 },
		webhooks: { pending: 0, retrying: 0, failed24h: 0 },
		reminders: { scheduled: 4, processing: 0, retrying: 0, failed24h: 0 },
		storage: { latest: null, growth: null },
		backup: {
			enabled: true,
			scheduleType: "daily",
			lastSuccessfulAt: null,
			lastFailedAt: null,
			staleAfterHours: 26,
			isStale: true,
		},
		restoreDrill: null,
		thresholds: { ...DEFAULT_OPERATIONAL_THRESHOLDS },
		...overrides,
	};
}

describe("operations summaries", () => {
	it("splits outbound mail into delivery states and a delivery rate", () => {
		const segments = getDeliverySegments(health());
		expect(segments.map((segment) => [segment.key, segment.count])).toEqual([
			["delivered", 90],
			["accepted", 2],
			["suppressed", 3],
			["unknown", 0],
			["failed", 5],
		]);
		expect(segments.reduce((sum, segment) => sum + segment.percent, 0)).toBeCloseTo(100);
		// Accepted mail has no final outcome yet, so it is left out of the rate.
		expect(getDeliveryRate(health())).toBeCloseTo((90 / 98) * 100);
	});

	it("has no delivery rate without finished mail", () => {
		const idle = health({
			delivery: {
				...health().delivery,
				delivered24h: 0,
				failed24h: 0,
				suppressed24h: 0,
				accepted24h: 4,
			},
		});
		expect(getDeliveryRate(idle)).toBeNull();
	});

	it("totals only queues whose metrics are available", () => {
		expect(getTotalBacklog(health())).toBe(3);
		expect(getOldestQueueMinutes(health(), NOW)).toBe(2);
		const unavailable = health({
			queues: health().queues.map((queue) => ({ ...queue, available: false })),
		});
		expect(getTotalBacklog(unavailable)).toBeNull();
	});

	it("rates queues by age before backlog", () => {
		const thresholds = {
			...DEFAULT_OPERATIONAL_THRESHOLDS,
			queueOldestMinutesWarning: 1,
			queueBacklogWarning: 2,
		};
		const [inbound, outbound, webhook] = health().queues;
		expect(queueTone(inbound, thresholds, NOW)).toBe("critical");
		expect(queueTone(outbound, thresholds, NOW)).toBe("good");
		expect(queueTone(webhook, thresholds, NOW)).toBe("warning");
	});

	it("formats queue ages for scanning", () => {
		expect(formatDuration(0)).toBe("under a minute");
		expect(formatDuration(75)).toBe("1 h 15 min");
		expect(formatDuration(60 * 72)).toBe("3 days");
		expect(formatDuration(null)).toBe("—");
	});
});

describe("operations actions", () => {
	it("links each alert to where it can be resolved", () => {
		expect(getAlertLink("BACKUP_STALE")).toMatchObject({ href: "/backups" });
		expect(getAlertLink("DELIVERY_UNKNOWN")).toMatchObject({ href: "/delivery-failures" });
		expect(getAlertLink("STORAGE_SNAPSHOT_MISSING")).toMatchObject({ kind: "measure" });
		expect(getAlertLink("QUEUE_AGE_INBOUND")).toMatchObject({ href: "#queues" });
		expect(getAlertLink("REMINDER_FAILED")).toBeNull();
	});

	it("explains failures instead of echoing status text", () => {
		expect(
			describeOperationsError(
				new OperationsRequestError("Forbidden", 403, null),
				"measure storage",
			),
		).toMatch(/permission to measure storage/);
		expect(describeOperationsError(new TypeError("fetch failed"), "refresh")).toMatch(/connection/);
		const recent = new OperationsRequestError("Confirm", 428, "RECENT_AUTHENTICATION_REQUIRED");
		expect(isRecentAuthenticationError(recent)).toBe(true);
	});

	it("validates thresholds against the API limits", () => {
		expect(validateThresholds(DEFAULT_OPERATIONAL_THRESHOLDS)).toEqual({});
		const errors = validateThresholds({
			...DEFAULT_OPERATIONAL_THRESHOLDS,
			queueBacklogWarning: 0,
			backupStaleHours: 0,
			d1GrowthPercentWarning: 2.5,
		});
		expect(Object.keys(errors).sort()).toEqual(["d1GrowthPercentWarning", "queueBacklogWarning"]);
	});
});
