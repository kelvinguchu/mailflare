import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import {
	completeMfaChallenge,
	createMfaChallenge,
	decryptTotpSecret,
	encryptTotpSecret,
	generateRecoveryCodes,
	verifyTotpCode,
} from "@/lib/auth/mfa";
import { getUserFromSession } from "@/lib/auth/session";
import { integrationEnv } from "./bindings";
import { resetIntegrationState } from "./fixtures";

beforeEach(async () => {
	await resetIntegrationState();
});

describe("administrator MFA challenge flow", () => {
	it("validates RFC 6238 SHA-1 vectors and prevents counter replay", async () => {
		const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
		expect(await verifyTotpCode(secret, "287082", null, 59_000)).toBe(1);
		expect(await verifyTotpCode(secret, "081804", null, 1_111_111_109_000)).toBe(37_037_036);
		expect(await verifyTotpCode(secret, "287082", 1, 59_000)).toBeNull();
	});

	it("encrypts TOTP secrets and generates hashed recovery codes", async () => {
		const env = mfaEnv();
		const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
		const encrypted = await encryptTotpSecret(env, secret);
		expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
		expect(encrypted).not.toContain(secret);
		expect(await decryptTotpSecret(env, encrypted)).toBe(secret);
		const recovery = await generateRecoveryCodes();
		expect(recovery.codes).toHaveLength(10);
		expect(new Set(recovery.codes)).toHaveLength(10);
		expect(recovery.codes.every((code) => /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/.test(code))).toBe(true);
		expect(recovery.hashes.every((hash) => /^[a-f0-9]{64}$/.test(hash))).toBe(true);
	});

	it("does not authenticate a challenge and consumes a recovery code once", async () => {
		const env = mfaEnv();
		const recovery = await generateRecoveryCodes();
		const encryptedSecret = await encryptTotpSecret(env, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
		await getDb(env).insert(users).values({
			id: "usr_mfa_admin",
			email: "mfa-admin@example.test",
			passwordHash: "hash",
			name: "MFA Admin",
			role: "admin",
			activationStatus: "active",
			mfaSecretEncrypted: encryptedSecret,
			mfaEnabledAt: new Date(),
			mfaRecoveryCodeHashes: JSON.stringify(recovery.hashes),
		});

		const challenge = await createMfaChallenge(env, "usr_mfa_admin");
		expect(await getUserFromSession(env, challenge)).toBeNull();
		const completed = await completeMfaChallenge(env, challenge, recovery.codes[0]!);
		expect(completed?.method).toBe("recovery");
		expect((await getUserFromSession(env, completed?.token))?.id).toBe("usr_mfa_admin");
		expect(await completeMfaChallenge(env, challenge, recovery.codes[0]!)).toBeNull();

		const [user] = await getDb(env).select({ hashes: users.mfaRecoveryCodeHashes })
			.from(users)
			.where(eq(users.id, "usr_mfa_admin"));
		expect(JSON.parse(user!.hashes)).toHaveLength(9);
		const rows = await getDb(env).select().from(sessions);
		expect(rows).toHaveLength(1);
		expect(rows[0]!.kind).toBe("authenticated");
	});
});

function mfaEnv(): CloudflareEnv {
	const key = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
	let binary = "";
	for (const byte of key) binary += String.fromCharCode(byte);
	return {
		DB: integrationEnv.DB,
		BUCKET: integrationEnv.BUCKET,
		DEPLOYMENT_ENV: "local",
		MFA_ENCRYPTION_KEY: btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""),
	} as unknown as CloudflareEnv;
}
