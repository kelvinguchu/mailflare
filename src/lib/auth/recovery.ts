import { and, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
	accountRecoveryTokens,
	auditLogs,
	sessions,
	users,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { createAuditLog } from "@/lib/mailboxes/audit";
import { hashPassword } from "./password";

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1_000;
const RECOVERY_EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1_000;

type RecoveryPurpose = "password_reset" | "recovery_email_verification";

export type PendingAuthEmail = {
	tokenId: string;
	userId: string;
	purpose: RecoveryPurpose;
	to: string;
	token: string;
};

export type RecoveryEmailVerificationPreparation =
	| { status: "missing" }
	| { status: "already_verified" }
	| { status: "delivery_disabled" }
	| { status: "pending"; email: PendingAuthEmail };

export function isAuthEmailDeliveryEnabled(env: CloudflareEnv): boolean {
	return env.AUTH_EMAIL_DELIVERY_MODE === "enabled";
}

export async function preparePasswordReset(
	env: CloudflareEnv,
	email: string,
): Promise<PendingAuthEmail | null> {
	if (!isAuthEmailDeliveryEnabled(env)) return null;
	const normalizedEmail = email.trim().toLowerCase();
	const [user] = await getDb(env)
		.select()
		.from(users)
		.where(eq(sql<string>`lower(${users.email})`, normalizedEmail))
		.limit(1);
	if (!user || user.disabled || !user.resetEmail || !user.resetEmailVerifiedAt) return null;

	const pending = await replaceRecoveryToken(env, {
		userId: user.id,
		purpose: "password_reset",
		email: user.resetEmail,
		ttlMs: PASSWORD_RESET_TTL_MS,
	});
	await recordRecoveryAudit(env, {
		targetUserId: user.id,
		action: "auth.password_reset_requested",
		metadata: { delivery: "scheduled" },
	});
	return pending;
}

export async function prepareRecoveryEmailVerification(
	env: CloudflareEnv,
	userId: string,
): Promise<RecoveryEmailVerificationPreparation> {
	const [user] = await getDb(env).select().from(users).where(eq(users.id, userId)).limit(1);
	if (!user?.resetEmail) return { status: "missing" };
	if (user.resetEmailVerifiedAt) return { status: "already_verified" };
	if (!isAuthEmailDeliveryEnabled(env)) return { status: "delivery_disabled" };

	const pending = await replaceRecoveryToken(env, {
		userId,
		purpose: "recovery_email_verification",
		email: user.resetEmail,
		ttlMs: RECOVERY_EMAIL_VERIFICATION_TTL_MS,
	});
	await recordRecoveryAudit(env, {
		actorUserId: userId,
		targetUserId: userId,
		action: "auth.recovery_email_verification_requested",
		metadata: { delivery: "scheduled" },
	});
	return { status: "pending", email: pending };
}

export async function deliverAuthEmail(env: CloudflareEnv, pending: PendingAuthEmail): Promise<void> {
	try {
		const origin = getPublicAppOrigin(env);
		const route = pending.purpose === "password_reset"
			? "/reset-password"
			: "/verify-recovery-email";
		const link = new URL(route, origin);
		link.searchParams.set("token", pending.token);
		const isReset = pending.purpose === "password_reset";
		const subject = isReset ? "Continue your CC Mail account recovery" : "Verify your CC Mail recovery email";
		const action = isReset ? "Continue account recovery" : "Verify recovery email";
		const expiry = isReset ? "30 minutes" : "24 hours";
		await env.EMAIL.send({
			from: env.AUTH_EMAIL_FROM,
			to: pending.to,
			subject,
			text: `${action}: ${link.toString()}\n\nThis link expires in ${expiry}. If you did not request it, you can ignore this email.`,
			html: `<p>${action}:</p><p><a href="${link.toString()}">${action}</a></p><p>This link expires in ${expiry}. If you did not request it, you can ignore this email.</p>`,
		});
	} catch (error) {
		try {
			await revokeRecoveryToken(env, pending.tokenId);
		} catch {
			console.error(JSON.stringify({ event: "auth_email_token_revocation_failed" }));
		}
		console.error(JSON.stringify({
			event: "auth_email_delivery_failed",
			purpose: pending.purpose,
			errorCode: getErrorCode(error),
		}));
		await recordRecoveryAudit(env, {
			targetUserId: pending.userId,
			action: "auth.email_delivery_failed",
			metadata: { purpose: pending.purpose, errorCode: getErrorCode(error) },
		});
		return;
	}
	await recordRecoveryAudit(env, {
		targetUserId: pending.userId,
		action: pending.purpose === "password_reset"
			? "auth.password_reset_email_sent"
			: "auth.recovery_email_verification_sent",
	});
}

export async function completeRecoveryEmailVerification(
	env: CloudflareEnv,
	token: string,
): Promise<boolean> {
	const claimed = await claimRecoveryToken(env, token, "recovery_email_verification");
	if (!claimed) return false;
	const updated = await getDb(env)
		.update(users)
		.set({ resetEmailVerifiedAt: new Date() })
		.where(and(eq(users.id, claimed.userId), eq(users.resetEmail, claimed.email)))
		.returning({ id: users.id });
	if (updated.length === 0) return false;
	await recordRecoveryAudit(env, {
		actorUserId: claimed.userId,
		targetUserId: claimed.userId,
		action: "auth.recovery_email_verified",
	});
	return true;
}

export async function completePasswordReset(
	env: CloudflareEnv,
	token: string,
	newPassword: string,
): Promise<boolean> {
	const claimed = await claimRecoveryToken(env, token, "password_reset");
	if (!claimed) return false;
	const [user] = await getDb(env)
		.select({ id: users.id })
		.from(users)
		.where(and(
			eq(users.id, claimed.userId),
			eq(users.resetEmail, claimed.email),
			isNotNull(users.resetEmailVerifiedAt),
			eq(users.disabled, false),
		))
		.limit(1);
	if (!user) return false;

	const db = getDb(env);
	await db.batch([
		db.update(users).set({ passwordHash: hashPassword(newPassword) }).where(eq(users.id, user.id)),
		db.delete(sessions).where(eq(sessions.userId, user.id)),
		db.delete(accountRecoveryTokens).where(eq(accountRecoveryTokens.userId, user.id)),
		db.insert(auditLogs).values({
			id: newId("aud"),
			actorUserId: user.id,
			targetUserId: user.id,
			action: "auth.password_reset_completed",
			metadata: JSON.stringify({ sessionsRevoked: true }),
		}),
	]);
	return true;
}

export async function changePasswordAndRevokeRecoveryTokens(
	env: CloudflareEnv,
	userId: string,
	newPassword: string,
): Promise<void> {
	const db = getDb(env);
	await db.batch([
		db.update(users).set({ passwordHash: hashPassword(newPassword) }).where(eq(users.id, userId)),
		db.delete(accountRecoveryTokens).where(eq(accountRecoveryTokens.userId, userId)),
		db.insert(auditLogs).values({
			id: newId("aud"),
			actorUserId: userId,
			targetUserId: userId,
			action: "auth.password_changed",
			metadata: JSON.stringify({ recoveryTokensRevoked: true }),
		}),
	]);
}

export async function deleteExpiredAccountRecoveryTokens(
	env: CloudflareEnv,
	now = new Date(),
): Promise<number> {
	const result = await getDb(env)
		.delete(accountRecoveryTokens)
		.where(lt(accountRecoveryTokens.expiresAt, now));
	return result.meta.changes;
}

export async function hashRecoveryToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return bytesToHex(new Uint8Array(digest));
}

function generateRecoveryToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return bytesToHex(bytes);
}

async function replaceRecoveryToken(
	env: CloudflareEnv,
	input: { userId: string; purpose: RecoveryPurpose; email: string; ttlMs: number },
): Promise<PendingAuthEmail> {
	const token = generateRecoveryToken();
	const tokenId = newId("art");
	const tokenHash = await hashRecoveryToken(token);
	const db = getDb(env);
	await db.batch([
		db.delete(accountRecoveryTokens).where(and(
			eq(accountRecoveryTokens.userId, input.userId),
			eq(accountRecoveryTokens.purpose, input.purpose),
		)),
		db.insert(accountRecoveryTokens).values({
			id: tokenId,
			userId: input.userId,
			purpose: input.purpose,
			tokenHash,
			email: input.email,
			expiresAt: new Date(Date.now() + input.ttlMs),
		}),
	]);
	return { tokenId, userId: input.userId, purpose: input.purpose, to: input.email, token };
}

async function claimRecoveryToken(
	env: CloudflareEnv,
	token: string,
	purpose: RecoveryPurpose,
): Promise<{ userId: string; email: string } | null> {
	const tokenHash = await hashRecoveryToken(token);
	const claimed = await getDb(env)
		.update(accountRecoveryTokens)
		.set({ usedAt: new Date() })
		.where(and(
			eq(accountRecoveryTokens.tokenHash, tokenHash),
			eq(accountRecoveryTokens.purpose, purpose),
			isNull(accountRecoveryTokens.usedAt),
			gt(accountRecoveryTokens.expiresAt, new Date()),
		))
		.returning({
			userId: accountRecoveryTokens.userId,
			email: accountRecoveryTokens.email,
		});
	return claimed[0] ?? null;
}

async function revokeRecoveryToken(env: CloudflareEnv, tokenId: string): Promise<void> {
	await getDb(env)
		.update(accountRecoveryTokens)
		.set({ usedAt: new Date() })
		.where(eq(accountRecoveryTokens.id, tokenId));
}

function getPublicAppOrigin(env: CloudflareEnv): string {
	const url = new URL(env.PUBLIC_APP_ORIGIN);
	if (url.protocol !== "https:" && !(env.DEPLOYMENT_ENV === "local" && url.protocol === "http:")) {
		throw new Error("Invalid public app origin");
	}
	return url.origin;
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function getErrorCode(error: unknown): string {
	if (typeof error === "object" && error !== null && "code" in error) {
		const code = (error as { code?: unknown }).code;
		if (typeof code === "string" && /^[A-Z0-9_]{1,96}$/.test(code.toUpperCase())) {
			return code.toUpperCase();
		}
	}
	return "AUTH_EMAIL_DELIVERY_ERROR";
}

async function recordRecoveryAudit(
	env: CloudflareEnv,
	input: Parameters<typeof createAuditLog>[1],
): Promise<void> {
	try {
		await createAuditLog(env, input);
	} catch {
		console.error(JSON.stringify({
			event: "auth_recovery_audit_failed",
			action: input.action,
		}));
	}
}
