import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/cookies";
import {
	buildTotpUri,
	decryptTotpSecret,
	encryptTotpSecret,
	generateRecoveryCodes,
	generateTotpSecret,
	isMfaEnabled,
	verifyAndConsumeMfaCode,
	verifyTotpCode,
} from "@/lib/auth/mfa";
import { verifyPassword } from "@/lib/auth/password";
import { markSessionAuthenticated, SESSION_COOKIE } from "@/lib/auth/session";
import { allowAccountRecoveryAttempt } from "@/lib/auth/rate-limit";
import { getEnv } from "@/lib/cloudflare";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { readJsonBody } from "@/lib/http/request";
import { createAuditLog } from "@/lib/mailboxes/audit";
import { mfaBeginSchema, mfaCodeSchema, mfaProtectedActionSchema } from "@/lib/validators";

export async function GET(request: Request) {
	const { user, error } = await requireAdministrator(request);
	if (error) return error;
	return NextResponse.json({
		enabled: isMfaEnabled(user!),
		recoveryCodesRemaining: parseRecoveryCount(user!.mfaRecoveryCodeHashes),
	});
}

export async function POST(request: Request) {
	const { env, user, error } = await requireAdministrator(request);
	if (error) return error;
	const parsed = await parseBody(request, mfaBeginSchema);
	if (parsed instanceof NextResponse) return parsed;
	if (!verifyPassword(parsed.currentPassword, user!.passwordHash)) {
		return NextResponse.json({ error: "Invalid password" }, { status: 401 });
	}
	if (isMfaEnabled(user!)) return NextResponse.json({ error: "Multi-factor authentication is already enabled" }, { status: 409 });
	const secret = generateTotpSecret();
	const encrypted = await encryptTotpSecret(env, secret);
	await getDb(env).update(users).set({
		mfaSecretEncrypted: encrypted,
		mfaEnabledAt: null,
		mfaRecoveryCodeHashes: "[]",
		mfaLastUsedCounter: null,
	}).where(eq(users.id, user!.id));
	return NextResponse.json({ secret, otpauthUri: buildTotpUri(user!.email, secret) });
}

export async function PUT(request: Request) {
	const { env, user, error } = await requireAdministrator(request);
	if (error) return error;
	const parsed = await parseBody(request, mfaCodeSchema);
	if (parsed instanceof NextResponse) return parsed;
	if (!user!.mfaSecretEncrypted || user!.mfaEnabledAt) {
		return NextResponse.json({ error: "Start multi-factor setup first" }, { status: 409 });
	}
	const secret = await decryptTotpSecret(env, user!.mfaSecretEncrypted);
	const counter = await verifyTotpCode(secret, parsed.code);
	if (counter === null) return NextResponse.json({ error: "Invalid verification code" }, { status: 401 });
	const recovery = await generateRecoveryCodes();
	await refreshCurrentAuthentication(env, user!.id);
	const updated = await getDb(env).update(users).set({
		mfaEnabledAt: new Date(),
		mfaRecoveryCodeHashes: JSON.stringify(recovery.hashes),
		mfaLastUsedCounter: counter,
	}).where(and(eq(users.id, user!.id), isNull(users.mfaEnabledAt))).returning({ id: users.id });
	if (updated.length !== 1) return NextResponse.json({ error: "Multi-factor setup changed; start again" }, { status: 409 });
	await createAuditLog(env, { actorUserId: user!.id, targetUserId: user!.id, action: "auth.mfa_enabled" });
	return NextResponse.json({ ok: true, recoveryCodes: recovery.codes });
}

export async function PATCH(request: Request) {
	const { env, user, error } = await requireAdministrator(request);
	if (error) return error;
	const parsed = await parseBody(request, mfaProtectedActionSchema);
	if (parsed instanceof NextResponse) return parsed;
	const verification = await verifyProtectedMfaAction(env, request, user!, parsed);
	if (verification) return verification;
	const recovery = await generateRecoveryCodes();
	await refreshCurrentAuthentication(env, user!.id);
	await getDb(env).update(users).set({ mfaRecoveryCodeHashes: JSON.stringify(recovery.hashes) })
		.where(eq(users.id, user!.id));
	await createAuditLog(env, { actorUserId: user!.id, targetUserId: user!.id, action: "auth.mfa_recovery_regenerated" });
	return NextResponse.json({ ok: true, recoveryCodes: recovery.codes });
}

export async function DELETE(request: Request) {
	const { env, user, error } = await requireAdministrator(request);
	if (error) return error;
	const parsed = await parseBody(request, mfaProtectedActionSchema);
	if (parsed instanceof NextResponse) return parsed;
	const verification = await verifyProtectedMfaAction(env, request, user!, parsed);
	if (verification) return verification;
	await refreshCurrentAuthentication(env, user!.id);
	await getDb(env).update(users).set({
		mfaSecretEncrypted: null,
		mfaEnabledAt: null,
		mfaRecoveryCodeHashes: "[]",
		mfaLastUsedCounter: null,
	}).where(eq(users.id, user!.id));
	await createAuditLog(env, { actorUserId: user!.id, targetUserId: user!.id, action: "auth.mfa_disabled" });
	return NextResponse.json({ ok: true });
}

async function requireAdministrator(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return { env, user: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
	if (user.role !== "admin") return { env, user: null, error: NextResponse.json({ error: "Administrator access required" }, { status: 403 }) };
	return { env, user, error: null };
}

async function parseBody<T>(request: Request, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): Promise<T | NextResponse> {
	try {
		const parsed = schema.safeParse(await readJsonBody(request, 8 * 1024));
		return parsed.success ? parsed.data : NextResponse.json({ error: "Invalid request" }, { status: 400 });
	} catch (error) {
		return NextResponse.json(
			{ error: "Invalid request" },
			{ status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
		);
	}
}

async function verifyProtectedMfaAction(
	env: CloudflareEnv,
	request: Request,
	user: typeof users.$inferSelect,
	input: { currentPassword: string; code: string },
): Promise<NextResponse | null> {
	if (!isMfaEnabled(user)) return NextResponse.json({ error: "Multi-factor authentication is not enabled" }, { status: 409 });
	if (!(await allowAccountRecoveryAttempt(env, request, user.id, "verify"))) {
		return NextResponse.json({ error: "Too many confirmation attempts" }, { status: 429 });
	}
	if (!verifyPassword(input.currentPassword, user.passwordHash)) {
		return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
	}
	if (!(await verifyAndConsumeMfaCode(env, user.id, input.code))) {
		return NextResponse.json({ error: "Invalid verification code" }, { status: 401 });
	}
	return null;
}

async function refreshCurrentAuthentication(env: CloudflareEnv, userId: string): Promise<void> {
	const token = (await cookies()).get(SESSION_COOKIE)?.value;
	if (!token || !(await markSessionAuthenticated(env, userId, token))) throw new Error("Current session is unavailable");
}

function parseRecoveryCount(value: string): number {
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.length : 0;
	} catch {
		return 0;
	}
}
