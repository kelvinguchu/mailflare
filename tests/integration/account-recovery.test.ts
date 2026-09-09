import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	changePasswordAndRevokeRecoveryTokens,
	completePasswordReset,
	completeRecoveryEmailVerification,
	deleteExpiredAccountRecoveryTokens,
	deliverAuthEmail,
	hashRecoveryToken,
	preparePasswordReset,
	prepareRecoveryEmailVerification,
} from "@/lib/auth/recovery";
import { verifyPassword } from "@/lib/auth/password";
import { integrationEnv } from "./bindings";
import { createMailEnv, fixtureIds, resetIntegrationState, seedMailboxWorld } from "./fixtures";

beforeEach(async () => {
	await resetIntegrationState();
	await seedMailboxWorld();
});

function recoveryEnv(send = vi.fn(async () => ({ messageId: "provider-auth-1" }))) {
	return {
		env: createMailEnv({
			AUTH_EMAIL_DELIVERY_MODE: "enabled",
			AUTH_EMAIL_FROM: "no-reply@calibercode.io",
			PUBLIC_APP_ORIGIN: "https://mail.calibercode.io",
			EMAIL: { send } as unknown as SendEmail,
		}),
		send,
	};
}

async function configureRecoveryEmail(verified: boolean) {
	await integrationEnv.DB.prepare(
		"UPDATE users SET reset_email = ?, reset_email_verified_at = ? WHERE id = ?",
	).bind(
		"owner-recovery@example.test",
		verified ? Math.floor(Date.now() / 1_000) : null,
		fixtureIds.owner,
	).run();
}

describe("secure account recovery with isolated D1", () => {
	it("stores only a reset-token hash, sends both email bodies, resets once, and revokes sessions", async () => {
		await configureRecoveryEmail(true);
		await integrationEnv.DB.prepare(
			"INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
		).bind("sess_recovery", fixtureIds.owner, "session-hash", 4_000_000_000, 1_700_000_000).run();
		const { env, send } = recoveryEnv();
		const pending = await preparePasswordReset(env, "OWNER@PRIMARY.TEST");
		expect(pending).not.toBeNull();

		const stored = await integrationEnv.DB.prepare(
			"SELECT token_hash, purpose FROM account_recovery_tokens WHERE user_id = ?",
		).bind(fixtureIds.owner).first<{ token_hash: string; purpose: string }>();
		expect(stored).toEqual({
			token_hash: await hashRecoveryToken(pending!.token),
			purpose: "password_reset",
		});
		expect(stored?.token_hash).not.toBe(pending!.token);

		await deliverAuthEmail(env, pending!);
		expect(send).toHaveBeenCalledWith(expect.objectContaining({
			to: "owner-recovery@example.test",
			text: expect.stringContaining(`/reset-password?token=${pending!.token}`),
			html: expect.stringContaining(`/reset-password?token=${pending!.token}`),
		}));

		expect(await completePasswordReset(env, pending!.token, "new-password-123")).toBe(true);
		const user = await integrationEnv.DB.prepare(
			"SELECT password_hash FROM users WHERE id = ?",
		).bind(fixtureIds.owner).first<{ password_hash: string }>();
		expect(verifyPassword("new-password-123", user!.password_hash)).toBe(true);
		expect(await integrationEnv.DB.prepare("SELECT COUNT(*) AS count FROM sessions").first()).toEqual({ count: 0 });
		expect(await integrationEnv.DB.prepare("SELECT COUNT(*) AS count FROM account_recovery_tokens").first()).toEqual({ count: 0 });
		expect(await completePasswordReset(env, pending!.token, "another-password-123")).toBe(false);
	});

	it("does not create reset tokens for unverified recovery addresses", async () => {
		await configureRecoveryEmail(false);
		const { env } = recoveryEnv();
		expect(await preparePasswordReset(env, "owner@primary.test")).toBeNull();
		expect(await integrationEnv.DB.prepare("SELECT COUNT(*) AS count FROM account_recovery_tokens").first()).toEqual({ count: 0 });
	});

	it("revokes outstanding recovery tokens after an authenticated password change", async () => {
		await configureRecoveryEmail(true);
		const { env } = recoveryEnv();
		expect(await preparePasswordReset(env, "owner@primary.test")).not.toBeNull();
		await changePasswordAndRevokeRecoveryTokens(env, fixtureIds.owner, "changed-password-123");
		expect(await integrationEnv.DB.prepare("SELECT COUNT(*) AS count FROM account_recovery_tokens").first()).toEqual({ count: 0 });
		const user = await integrationEnv.DB.prepare(
			"SELECT password_hash FROM users WHERE id = ?",
		).bind(fixtureIds.owner).first<{ password_hash: string }>();
		expect(verifyPassword("changed-password-123", user!.password_hash)).toBe(true);
	});

	it("verifies the current recovery address with a single-use token", async () => {
		await configureRecoveryEmail(false);
		const { env } = recoveryEnv();
		const prepared = await prepareRecoveryEmailVerification(env, fixtureIds.owner);
		expect(prepared.status).toBe("pending");
		if (prepared.status !== "pending") throw new Error("Expected pending verification");
		expect(await completeRecoveryEmailVerification(env, prepared.email.token)).toBe(true);
		const user = await integrationEnv.DB.prepare(
			"SELECT reset_email_verified_at FROM users WHERE id = ?",
		).bind(fixtureIds.owner).first<{ reset_email_verified_at: number | null }>();
		expect(user?.reset_email_verified_at).toEqual(expect.any(Number));
		expect(await completeRecoveryEmailVerification(env, prepared.email.token)).toBe(false);
	});

	it("rejects expired tokens and removes them during retention cleanup", async () => {
		await configureRecoveryEmail(true);
		const { env } = recoveryEnv();
		const pending = await preparePasswordReset(env, "owner@primary.test");
		await integrationEnv.DB.prepare(
			"UPDATE account_recovery_tokens SET expires_at = ? WHERE id = ?",
		).bind(1_700_000_000, pending!.tokenId).run();
		expect(await completePasswordReset(env, pending!.token, "new-password-123")).toBe(false);
		expect(await deleteExpiredAccountRecoveryTokens(env, new Date())).toBe(1);
	});
});
