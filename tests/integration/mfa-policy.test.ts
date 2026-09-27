import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
	evaluateMfaPolicy,
	getMfaPolicy,
	syncUserMfaPolicyCoverage,
	updateMfaPolicy,
} from "@/lib/auth/mfa-policy";
import {
	createSession,
	getPolicyAuthorizedUserFromSession,
	getUserFromSession,
} from "@/lib/auth/session";
import { createMailEnv, fixtureIds, resetIntegrationState, seedMailboxWorld } from "./fixtures";

beforeEach(async () => {
	await resetIntegrationState();
	await seedMailboxWorld();
});

describe("workspace MFA policy", () => {
	it("starts optional and gives existing administrators a bounded enrollment grace period", async () => {
		const env = createMailEnv();
		expect(await getMfaPolicy(env)).toMatchObject({ mode: "optional", gracePeriodDays: 7 });
		const startedAt = new Date("2026-09-15T12:00:00Z");
		await updateMfaPolicy(
			env,
			{ mode: "administrators", gracePeriodDays: 7, actorUserId: fixtureIds.owner },
			startedAt,
		);
		const [owner, delegate] = await getDb(env).select().from(users);
		const policy = await getMfaPolicy(env);
		expect(owner?.mfaPolicyCoveredAt).toEqual(startedAt);
		expect(delegate?.mfaPolicyCoveredAt).toBeNull();
		expect(evaluateMfaPolicy(owner!, policy, new Date("2026-09-20T12:00:00Z")).state).toBe("grace");
		expect(evaluateMfaPolicy(owner!, policy, new Date("2026-09-22T12:00:00Z")).state).toBe(
			"restricted",
		);
	});

	it("blocks ordinary session authorization after grace while preserving the underlying session", async () => {
		const env = createMailEnv();
		await updateMfaPolicy(
			env,
			{ mode: "administrators", gracePeriodDays: 0, actorUserId: fixtureIds.owner },
			new Date(Date.now() - 1_000),
		);
		const token = await createSession(env, fixtureIds.owner);
		expect(await getUserFromSession(env, token)).toMatchObject({ id: fixtureIds.owner });
		expect(await getPolicyAuthorizedUserFromSession(env, token)).toBeNull();
	});

	it("accepts MFA compliance and only honors unexpired exceptions", async () => {
		const env = createMailEnv();
		const now = new Date("2026-09-15T12:00:00Z");
		await updateMfaPolicy(
			env,
			{ mode: "all_users", gracePeriodDays: 0, actorUserId: fixtureIds.owner },
			now,
		);
		const db = getDb(env);
		await db
			.update(users)
			.set({
				mfaPolicyExemptUntil: new Date("2026-09-16T12:00:00Z"),
				mfaPolicyExemptionReason: "Authenticator replacement",
			})
			.where(eq(users.id, fixtureIds.delegate));
		let [delegate] = await db.select().from(users).where(eq(users.id, fixtureIds.delegate));
		const policy = await getMfaPolicy(env);
		expect(evaluateMfaPolicy(delegate!, policy, now).state).toBe("exempt");
		expect(evaluateMfaPolicy(delegate!, policy, new Date("2026-09-17T12:00:00Z")).state).toBe(
			"restricted",
		);
		await db
			.update(users)
			.set({ mfaSecretEncrypted: "encrypted", mfaEnabledAt: now })
			.where(eq(users.id, fixtureIds.delegate));
		[delegate] = await db.select().from(users).where(eq(users.id, fixtureIds.delegate));
		expect(evaluateMfaPolicy(delegate!, policy, new Date("2026-09-17T12:00:00Z")).state).toBe(
			"compliant",
		);
	});

	it("starts a new grace period when an existing user is promoted", async () => {
		const env = createMailEnv();
		await updateMfaPolicy(
			env,
			{ mode: "administrators", gracePeriodDays: 7, actorUserId: fixtureIds.owner },
			new Date("2026-09-01T00:00:00Z"),
		);
		await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?")
			.bind(fixtureIds.delegate)
			.run();
		const promotedAt = new Date("2026-09-15T12:00:00Z");
		await syncUserMfaPolicyCoverage(env, fixtureIds.delegate, promotedAt);
		const promoted = await env.DB.prepare("SELECT mfa_policy_covered_at FROM users WHERE id = ?")
			.bind(fixtureIds.delegate)
			.first<{ mfa_policy_covered_at: number }>();
		expect(promoted?.mfa_policy_covered_at).toBe(Math.floor(promotedAt.getTime() / 1_000));
	});
});
