import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { auditLogs } from "@/db/schema";
import { listRecentSignIns } from "@/lib/auth/activity";
import { changePasswordAndRevokeRecoveryTokens } from "@/lib/auth/recovery";
import {
	countActiveSessions,
	createSession,
	deleteExpiredSessions,
	getCurrentSessionDetails,
	getUserFromSession,
	isSessionRecentlyAuthenticated,
	markSessionAuthenticated,
	revokeAllSessions,
	revokeOtherSessions,
} from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { newId } from "@/lib/ids";
import { integrationEnv } from "./bindings";
import { createMailEnv, fixtureIds, resetIntegrationState, seedMailboxWorld } from "./fixtures";

beforeEach(async () => {
	await resetIntegrationState();
	await seedMailboxWorld();
});

function sessionEnv() {
	const fetch = vi.fn(async () => new Response(null, { status: 204 }));
	const getByName = vi.fn(() => ({ fetch }));
	return {
		env: createMailEnv({ REALTIME: { getByName } as unknown as CloudflareEnv["REALTIME"] }),
		fetch,
		getByName,
	};
}

describe("session management with isolated D1", () => {
	it("preserves the current session and immediately revokes every other session", async () => {
		const { env, fetch, getByName } = sessionEnv();
		const currentToken = await createSession(env, fixtureIds.owner);
		const otherToken = await createSession(env, fixtureIds.owner);

		expect(await revokeOtherSessions(env, fixtureIds.owner, currentToken)).toBe(1);
		expect(await getUserFromSession(env, currentToken)).toMatchObject({ id: fixtureIds.owner });
		expect(await getUserFromSession(env, otherToken)).toBeNull();
		expect(await countActiveSessions(env, fixtureIds.owner)).toBe(1);
		expect(await getCurrentSessionDetails(env, fixtureIds.owner, currentToken)).not.toBeNull();
		expect(getByName).toHaveBeenCalledWith(fixtureIds.owner);
		expect(fetch).toHaveBeenCalledWith("https://cc-mail-realtime/disconnect", { method: "POST" });
	});

	it("revokes every session for administrator-initiated sign-out", async () => {
		const { env, fetch } = sessionEnv();
		await createSession(env, fixtureIds.delegate);
		await createSession(env, fixtureIds.delegate);

		expect(await revokeAllSessions(env, fixtureIds.delegate)).toBe(2);
		expect(await countActiveSessions(env, fixtureIds.delegate)).toBe(0);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("removes only expired sessions during retention cleanup", async () => {
		const env = createMailEnv();
		await createSession(env, fixtureIds.owner);
		await integrationEnv.DB.prepare(
			"INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
		).bind("sess_expired", fixtureIds.owner, "expired-hash", 1_700_000_000, 1_700_000_000).run();

		expect(await deleteExpiredSessions(env, new Date())).toBe(1);
		expect(await countActiveSessions(env, fixtureIds.owner)).toBe(1);
	});

	it("requires and refreshes recent authentication for sensitive actions", async () => {
		const env = createMailEnv();
		const token = await createSession(env, fixtureIds.owner);
		expect(await isSessionRecentlyAuthenticated(env, fixtureIds.owner, token)).toBe(true);
		await integrationEnv.DB.prepare(
			"UPDATE sessions SET authenticated_at = ? WHERE user_id = ?",
		).bind(1_700_000_000, fixtureIds.owner).run();
		expect(await isSessionRecentlyAuthenticated(env, fixtureIds.owner, token)).toBe(false);
		expect(await markSessionAuthenticated(env, fixtureIds.owner, token)).toBe(true);
		expect(await isSessionRecentlyAuthenticated(env, fixtureIds.owner, token)).toBe(true);
	});

	it("returns only the account owner's recent successful sign-ins", async () => {
		const env = createMailEnv();
		const db = getDb(env);
		await db.insert(auditLogs).values([
			{
				id: newId("aud"),
				actorUserId: fixtureIds.owner,
				targetUserId: fixtureIds.owner,
				action: "auth.login",
				metadata: JSON.stringify({ ipAddress: "203.0.113.10" }),
				createdAt: new Date("2026-09-09T08:00:00Z"),
			},
			{
				id: newId("aud"),
				actorUserId: fixtureIds.owner,
				targetUserId: fixtureIds.owner,
				action: "auth.logout",
				createdAt: new Date("2026-09-09T09:00:00Z"),
			},
			{
				id: newId("aud"),
				actorUserId: fixtureIds.stranger,
				targetUserId: fixtureIds.stranger,
				action: "auth.login",
				metadata: JSON.stringify({ ipAddress: "203.0.113.99" }),
				createdAt: new Date("2026-09-09T10:00:00Z"),
			},
		]);

		const signIns = await listRecentSignIns(env, fixtureIds.owner);
		expect(signIns).toHaveLength(1);
		expect(signIns[0]?.metadata).toContain("203.0.113.10");
	});

	it("keeps the current browser signed in when a password change revokes other sessions", async () => {
		const { env, fetch } = sessionEnv();
		const currentToken = await createSession(env, fixtureIds.owner);
		const otherToken = await createSession(env, fixtureIds.owner);

		expect(await changePasswordAndRevokeRecoveryTokens(
			env,
			fixtureIds.owner,
			"changed-password-123",
			currentToken,
		)).toBe(1);
		expect(await getUserFromSession(env, currentToken)).toMatchObject({ id: fixtureIds.owner });
		expect(await getUserFromSession(env, otherToken)).toBeNull();
		const user = await integrationEnv.DB.prepare(
			"SELECT password_hash FROM users WHERE id = ?",
		).bind(fixtureIds.owner).first<{ password_hash: string }>();
		expect(verifyPassword("changed-password-123", user!.password_hash)).toBe(true);
		expect(fetch).toHaveBeenCalledOnce();
	});
});
