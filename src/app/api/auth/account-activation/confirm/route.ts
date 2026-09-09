import { NextResponse } from "next/server";
import { completeAccountActivation } from "@/lib/auth/recovery";
import { recordAuthActivity } from "@/lib/auth/activity";
import { createSession } from "@/lib/auth/session";
import { createAuthenticatedResponse } from "@/lib/auth/http-response";
import { allowAccountRecoveryAttempt } from "@/lib/auth/rate-limit";
import { getEnv } from "@/lib/cloudflare";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { readJsonBody } from "@/lib/http/request";
import { accountActivationConfirmSchema } from "@/lib/validators";

export async function POST(request: Request) {
	const env = getEnv();
	let body: unknown;
	try {
		body = await readJsonBody(request, 16 * 1024);
	} catch (error) {
		return NextResponse.json(
			{ error: "Invalid account activation request" },
			{ status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
		);
	}
	const parsed = accountActivationConfirmSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "This activation link is invalid or expired" }, { status: 400 });
	}
	if (!(await allowAccountRecoveryAttempt(env, request, parsed.data.token, "activate"))) {
		return NextResponse.json({ error: "Too many attempts. Try again shortly." }, {
			status: 429,
			headers: { "Retry-After": "60" },
		});
	}

	const userId = await completeAccountActivation(env, parsed.data.token, parsed.data.newPassword);
	if (!userId) {
		return NextResponse.json({ error: "This activation link is invalid or expired" }, { status: 400 });
	}
	const sessionToken = await createSession(env, userId);
	await recordAuthActivity(env, { action: "auth.login", userId, request });
	return createAuthenticatedResponse(sessionToken, "/inbox");
}
