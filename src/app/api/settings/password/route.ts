import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ZodError } from "zod";
import { getCurrentUser } from "@/lib/auth/cookies";
import { verifyPassword } from "@/lib/auth/password";
import { changePasswordAndRevokeRecoveryTokens } from "@/lib/auth/recovery";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { getEnv } from "@/lib/cloudflare";
import type { ChangePasswordInput } from "./types";
import { parseChangePasswordRequest } from "./utils";

export async function PATCH(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	let parsed: ChangePasswordInput;

	try {
		parsed = await parseChangePasswordRequest(request);
	} catch (err) {
		if (err instanceof ZodError) {
			return NextResponse.json({ error: err.flatten() }, { status: 400 });
		}
		return NextResponse.json({ error: "Invalid request" }, { status: 400 });
	}

	if (!verifyPassword(parsed.currentPassword, user.passwordHash)) {
		return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
	}

	if (verifyPassword(parsed.newPassword, user.passwordHash)) {
		return NextResponse.json({ error: "New password must be different from the current password" }, { status: 400 });
	}

	const jar = await cookies();
	const currentSessionToken = jar.get(SESSION_COOKIE)?.value;
	if (!currentSessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const revokedSessions = await changePasswordAndRevokeRecoveryTokens(
		env,
		user.id,
		parsed.newPassword,
		currentSessionToken,
	);

	return NextResponse.json({ ok: true, revokedSessions });
}
