import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth/password";
import { getCurrentUser } from "@/lib/auth/cookies";
import { isMfaEnabled, verifyAndConsumeMfaCode } from "@/lib/auth/mfa";
import { markSessionAuthenticated, SESSION_COOKIE } from "@/lib/auth/session";
import { allowAccountRecoveryAttempt } from "@/lib/auth/rate-limit";
import { getEnv } from "@/lib/cloudflare";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { readJsonBody } from "@/lib/http/request";
import { createAuditLog } from "@/lib/mailboxes/audit";
import { reauthenticateSchema } from "@/lib/validators";

export async function POST(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	let body: unknown;
	try {
		body = await readJsonBody(request, 8 * 1024);
	} catch (error) {
		return NextResponse.json(
			{ error: "Invalid confirmation request" },
			{ status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
		);
	}
	const parsed = reauthenticateSchema.safeParse(body);
	if (!parsed.success) return NextResponse.json({ error: "Invalid confirmation request" }, { status: 400 });
	if (!(await allowAccountRecoveryAttempt(env, request, user.id, "verify"))) {
		return NextResponse.json({ error: "Too many confirmation attempts" }, { status: 429 });
	}
	if (!verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
		return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
	}
	let method: "password" | "totp" | "recovery" = "password";
	if (isMfaEnabled(user)) {
		const verified = await verifyAndConsumeMfaCode(env, user.id, parsed.data.code);
		if (!verified) return NextResponse.json({ error: "Invalid verification code" }, { status: 401 });
		method = verified;
	}
	const token = (await cookies()).get(SESSION_COOKIE)?.value;
	if (!token || !(await markSessionAuthenticated(env, user.id, token))) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	await createAuditLog(env, {
		actorUserId: user.id,
		targetUserId: user.id,
		action: "auth.reauthenticated",
		metadata: { method },
	});
	return NextResponse.json({ ok: true });
}
