import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { authenticateApiKey, requireScope } from "@/lib/api/auth";
import { sendEmailSchema } from "@/lib/validators";
import { queueEmail } from "@/lib/email/send";
import { decodeBase64Content } from "@/lib/email/attachments";
import { readJsonBody } from "@/lib/http/request";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { getSendErrorStatus } from "@/app/api/send/error-utils";
import { IdempotencyConflictError } from "@/lib/email/outbound-idempotency";

export async function POST(request: Request) {
	const env = getEnv();
	const auth = await authenticateApiKey(env, request.headers.get("authorization"));
	if (!auth || !requireScope(auth.scopes, "send")) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: unknown;
	try {
		body = await readJsonBody(request, 30 * 1024 * 1024);
	} catch (error) {
		const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
		return NextResponse.json({ error: "Invalid send request" }, { status });
	}
	const parsed = sendEmailSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
	}

	try {
		const { attachments, ...fields } = parsed.data;
		const result = await queueEmail(
			env,
			{
				userId: auth.userId,
				...fields,
				attachments: attachments?.map((attachment) => ({
					filename: attachment.filename,
					type: attachment.type,
					content: decodeBase64Content(attachment.contentBase64),
					disposition: "attachment",
				})),
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
