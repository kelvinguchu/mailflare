import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { requireUser } from "@/lib/auth/cookies";
import { sendEmailSchema } from "@/lib/validators";
import { queueEmail } from "@/lib/email/send";
import { parseSendRequest } from "./utils";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { getSendErrorStatus } from "./error-utils";
import { IdempotencyConflictError } from "@/lib/email/outbound-idempotency";

export async function POST(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	let input;
	try {
		input = await parseSendRequest(request);
	} catch (error) {
		const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
		return NextResponse.json({ error: "Invalid send request" }, { status });
	}
	const { attachments, ...fields } = input;
	const parsed = sendEmailSchema.omit({ attachments: true }).safeParse(fields);
	if (!parsed.success) {
		return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
	}

	try {
		const result = await queueEmail(
			env,
			{
				userId: user.id,
				...parsed.data,
				attachments,
			},
			{ idempotencyKey: request.headers.get("Idempotency-Key") },
		);
		return NextResponse.json(result, {
			status: result.status === "queued" || result.status === "sending" ? 202 : 200,
			headers: { "Idempotency-Key": result.idempotencyKey },
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "Send failed";
		const status = err instanceof IdempotencyConflictError ? 409 : getSendErrorStatus(message);
		return NextResponse.json({ error: message }, { status });
	}
}
