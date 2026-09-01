import { describe, expect, it } from "vitest";
import {
	getScheduledBackupRecordId,
	isBackupDue,
} from "../src/lib/backups/utils";

describe("automatic backup schedule", () => {
	it("runs a daily schedule on every UTC date", () => {
		expect(isBackupDue("daily", null, new Date("2026-09-01T02:00:00Z"))).toBe(true);
	});

	it("runs a weekly schedule only on the selected UTC weekday", () => {
		const tuesday = new Date("2026-09-01T02:00:00Z");
		expect(isBackupDue("weekly", 2, tuesday)).toBe(true);
		expect(isBackupDue("weekly", 1, tuesday)).toBe(false);
	});

	it("runs a monthly schedule only on the selected UTC day", () => {
		const first = new Date("2026-09-01T02:00:00Z");
		expect(isBackupDue("monthly", 1, first)).toBe(true);
		expect(isBackupDue("monthly", 2, first)).toBe(false);
	});

	it("uses one idempotency key for repeated invocations on the same UTC date", () => {
		const first = getScheduledBackupRecordId(new Date("2026-09-01T02:00:00Z"));
		const repeated = getScheduledBackupRecordId(new Date("2026-09-01T23:59:59Z"));
		const nextDay = getScheduledBackupRecordId(new Date("2026-09-02T02:00:00Z"));

		expect(first).toBe("bak_scheduled_2026-09-01");
		expect(repeated).toBe(first);
		expect(nextDay).not.toBe(first);
	});
});
