import { NextResponse } from "next/server";
import { createLoggedOutResponse } from "@/lib/auth/http-response";
import { allowAccountRecoveryAttempt } from "@/lib/auth/rate-limit";
import { completePasswordReset } from "@/lib/auth/recovery";
import { getEnv } from "@/lib/cloudflare";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { readJsonBody } from "@/lib/http/request";
import { passwordResetConfirmSchema } from "@/lib/validators";

export async function POST(request: Request) {
	const env = getEnv();
	let body: unknown;
	try {
		body = await readJsonBody(request, 16 * 1024);
	} catch (error) {
		return NextResponse.json(
			{ error: "Invalid password reset request" },
			{ status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
		);
	}
	const parsed = passwordResetConfirmSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
	}
	if (!(await allowAccountRecoveryAttempt(env, request, parsed.data.token, "confirm"))) {
		return NextResponse.json(
			{ error: "Too many attempts. Try again shortly." },
			{ status: 429, headers: { "Retry-After": "60" } },
		);
	}

	const completed = await completePasswordReset(env, parsed.data.token, parsed.data.newPassword);
	if (!completed) {
		return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
	}
	return createLoggedOutResponse();
}
