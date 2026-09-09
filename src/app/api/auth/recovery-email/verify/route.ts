import { NextResponse } from "next/server";
import { allowAccountRecoveryAttempt } from "@/lib/auth/rate-limit";
import { completeRecoveryEmailVerification } from "@/lib/auth/recovery";
import { getEnv } from "@/lib/cloudflare";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { readJsonBody } from "@/lib/http/request";
import { recoveryEmailVerificationSchema } from "@/lib/validators";

export async function POST(request: Request) {
	const env = getEnv();
	let body: unknown;
	try {
		body = await readJsonBody(request, 16 * 1024);
	} catch (error) {
		return NextResponse.json(
			{ error: "Invalid verification request" },
			{ status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
		);
	}
	const parsed = recoveryEmailVerificationSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid or expired verification link" }, { status: 400 });
	}
	if (!(await allowAccountRecoveryAttempt(env, request, parsed.data.token, "verify"))) {
		return NextResponse.json(
			{ error: "Too many attempts. Try again shortly." },
			{ status: 429, headers: { "Retry-After": "60" } },
		);
	}
	const completed = await completeRecoveryEmailVerification(env, parsed.data.token);
	if (!completed) {
		return NextResponse.json({ error: "Invalid or expired verification link" }, { status: 400 });
	}
	return NextResponse.json({ ok: true });
}
