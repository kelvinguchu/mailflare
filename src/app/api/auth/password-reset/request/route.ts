import { NextResponse } from "next/server";
import { getEnv, getExecutionContext } from "@/lib/cloudflare";
import { allowAccountRecoveryAttempt } from "@/lib/auth/rate-limit";
import { deliverAuthEmail, preparePasswordReset } from "@/lib/auth/recovery";
import { verifyTurnstileToken } from "@/lib/auth/turnstile";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { readJsonBody } from "@/lib/http/request";
import { passwordResetRequestSchema } from "@/lib/validators";

const GENERIC_RESPONSE = {
	ok: true,
	message: "If that account has a verified recovery email, a reset link will arrive shortly.",
};

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
	const parsed = passwordResetRequestSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
	}

	if (!(await verifyTurnstileToken(env, request, (body as Record<string, unknown>).turnstileToken))) {
		return NextResponse.json({ error: "Verification failed. Please try again." }, { status: 400 });
	}
	const allowed = await allowAccountRecoveryAttempt(
		env,
		request,
		parsed.data.email,
		"request",
	);
	if (!allowed) return NextResponse.json(GENERIC_RESPONSE, { status: 202 });

	try {
		const pending = await preparePasswordReset(env, parsed.data.email);
		if (pending) getExecutionContext().waitUntil(deliverAuthEmail(env, pending));
	} catch {
		console.error(JSON.stringify({ event: "password_reset_request_failed" }));
	}
	return NextResponse.json(GENERIC_RESPONSE, { status: 202 });
}
