import { NextResponse } from "next/server";
import { completeMfaChallenge } from "@/lib/auth/mfa";
import { createAuthenticatedResponse } from "@/lib/auth/http-response";
import { allowLoginAttempt } from "@/lib/auth/rate-limit";
import { recordAuthActivity } from "@/lib/auth/activity";
import { getEnv } from "@/lib/cloudflare";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { readJsonBody } from "@/lib/http/request";
import { mfaVerifySchema } from "@/lib/validators";

export async function POST(request: Request) {
	const env = getEnv();
	let body: unknown;
	try {
		body = await readJsonBody(request, 8 * 1024);
	} catch (error) {
		return NextResponse.json(
			{ error: "Invalid verification request" },
			{ status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
		);
	}
	const parsed = mfaVerifySchema.safeParse(body);
	if (!parsed.success) return NextResponse.json({ error: "Invalid verification request" }, { status: 400 });
	if (!(await allowLoginAttempt(env, request))) {
		return NextResponse.json(
			{ error: "Too many verification attempts. Try again shortly." },
			{ status: 429, headers: { "Retry-After": "60" } },
		);
	}
	const completed = await completeMfaChallenge(env, parsed.data.challengeToken, parsed.data.code);
	if (!completed) return NextResponse.json({ error: "Invalid or expired verification code" }, { status: 401 });
	await recordAuthActivity(env, { action: "auth.login", userId: completed.userId, request });
	return createAuthenticatedResponse(completed.token, "/inbox");
}
