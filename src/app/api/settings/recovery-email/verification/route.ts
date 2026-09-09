import { NextResponse } from "next/server";
import { allowAccountRecoveryAttempt } from "@/lib/auth/rate-limit";
import { deliverAuthEmail, prepareRecoveryEmailVerification } from "@/lib/auth/recovery";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv, getExecutionContext } from "@/lib/cloudflare";

export async function POST(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	if (!(await allowAccountRecoveryAttempt(env, request, user.id, "verify"))) {
		return NextResponse.json(
			{ error: "Too many requests. Try again shortly." },
			{ status: 429, headers: { "Retry-After": "60" } },
		);
	}
	const result = await prepareRecoveryEmailVerification(env, user.id);
	if (result.status === "missing") {
		return NextResponse.json({ error: "Save a recovery email first" }, { status: 400 });
	}
	if (result.status === "already_verified") {
		return NextResponse.json({ ok: true, verified: true });
	}
	if (result.status === "delivery_disabled") {
		return NextResponse.json({ error: "Recovery email delivery is unavailable" }, { status: 503 });
	}
	getExecutionContext().waitUntil(deliverAuthEmail(env, result.email));
	return NextResponse.json({ ok: true, verified: false }, { status: 202 });
}
