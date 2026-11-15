import { beforeEach, describe, expect, it } from "vitest";
import {
	checkDriveUser,
	createDriveSsoCode,
	deleteExpiredDriveSsoCodes,
	redeemDriveSsoCode,
} from "@/lib/drive/sso";
import { integrationEnv } from "./bindings";
import { fixtureIds, resetIntegrationState, seedMailboxWorld } from "./fixtures";

const state = "s".repeat(43);
const otherState = "t".repeat(43);
const now = new Date("2026-11-15T10:00:00Z");
const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);

beforeEach(async () => {
	await resetIntegrationState();
	await integrationEnv.DB.prepare("DELETE FROM drive_sso_codes").run();
	await seedMailboxWorld();
});

describe("drive sign-in codes", () => {
	it("redeems a fresh code once, for the matching state, returning the user", async () => {
		const code = await createDriveSsoCode(integrationEnv, fixtureIds.owner, state, now);
		const user = await redeemDriveSsoCode(integrationEnv, code, state, later(30));
		expect(user).toMatchObject({ id: fixtureIds.owner, email: "owner@primary.test", role: "admin" });
		expect(await redeemDriveSsoCode(integrationEnv, code, state, later(31))).toBeNull();
	});

	it("refuses a code redeemed with a different state", async () => {
		const code = await createDriveSsoCode(integrationEnv, fixtureIds.owner, state, now);
		expect(await redeemDriveSsoCode(integrationEnv, code, otherState, later(1))).toBeNull();
		// A wrong guess doesn't burn the code for its real owner.
		expect(await redeemDriveSsoCode(integrationEnv, code, state, later(2))).not.toBeNull();
	});

	it("refuses an expired code", async () => {
		const code = await createDriveSsoCode(integrationEnv, fixtureIds.owner, state, now);
		expect(await redeemDriveSsoCode(integrationEnv, code, state, later(61))).toBeNull();
	});

	it("refuses malformed input without touching the database", async () => {
		expect(await redeemDriveSsoCode(integrationEnv, "x", state, now)).toBeNull();
		expect(await redeemDriveSsoCode(integrationEnv, 42, state, now)).toBeNull();
		await expect(createDriveSsoCode(integrationEnv, fixtureIds.owner, "short", now)).rejects.toThrow();
	});

	it("refuses a user who was disabled after the code was made", async () => {
		const code = await createDriveSsoCode(integrationEnv, fixtureIds.delegate, state, now);
		await integrationEnv.DB.prepare("UPDATE users SET disabled = 1 WHERE id = ?").bind(fixtureIds.delegate).run();
		expect(await redeemDriveSsoCode(integrationEnv, code, state, later(1))).toBeNull();
	});

	it("stores only hashes", async () => {
		const code = await createDriveSsoCode(integrationEnv, fixtureIds.owner, state, now);
		const row = await integrationEnv.DB.prepare("SELECT code_hash, state_hash FROM drive_sso_codes").first<{
			code_hash: string;
			state_hash: string;
		}>();
		expect(row?.code_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(row?.code_hash).not.toContain(code);
		expect(row?.state_hash).not.toBe(state);
	});

	it("cleans up codes a day after they expire", async () => {
		await createDriveSsoCode(integrationEnv, fixtureIds.owner, state, now);
		expect(await deleteExpiredDriveSsoCodes(integrationEnv, later(60 * 60))).toBe(0);
		expect(await deleteExpiredDriveSsoCodes(integrationEnv, later(25 * 60 * 60))).toBe(1);
	});
});

describe("drive account checks", () => {
	it("reports active users and their role", async () => {
		expect(await checkDriveUser(integrationEnv, fixtureIds.owner)).toEqual({ active: true, role: "admin" });
		expect(await checkDriveUser(integrationEnv, fixtureIds.delegate)).toMatchObject({ active: true });
	});

	it("reports disabled, archived, unknown and malformed users as inactive", async () => {
		await integrationEnv.DB.prepare("UPDATE users SET archived_at = 1 WHERE id = ?").bind(fixtureIds.delegate).run();
		expect((await checkDriveUser(integrationEnv, fixtureIds.delegate)).active).toBe(false);
		expect((await checkDriveUser(integrationEnv, "usr_missing")).active).toBe(false);
		expect((await checkDriveUser(integrationEnv, "")).active).toBe(false);
		expect((await checkDriveUser(integrationEnv, 7)).active).toBe(false);
	});
});
