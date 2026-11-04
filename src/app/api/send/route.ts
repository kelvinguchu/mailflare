import { z } from "zod";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/cookies";
import { sendEmailSchema } from "@/lib/validators";
import { getForwardSource } from "@/lib/email/forward";
import { getSendOutcome, queueEmail } from "@/lib/email/send";
import { parseSendRequest } from "./utils";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { getSendErrorStatus } from "./error-utils";
import { IdempotencyConflictError } from "@/lib/email/outbound-idempotency";
import { parseUndoSendDelay } from "@/lib/email/undo-send";
import { SendLimitError } from "@/lib/email/limits";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	const key = request.headers.get("Idempotency-Key");
	if (!key) return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 });
	try {
		const result = await getSendOutcome(env, user.id, key);
		return NextResponse.json(result ?? { error: "Send not found" }, {
			status: result ? 200 : 404,
			headers: { "Cache-Control": "private, no-store" },
		});
	} catch {
		return NextResponse.json({ error: "Send status could not be checked" }, { status: 503 });
	}
}

export async function POST(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	let input;
	const parsingStarted = performance.now();
	try {
		input = await parseSendRequest(request);
		console.info(
			JSON.stringify({
				event: "outbound_stage",
				stage: "request_parsing",
				durationMs: Math.round(performance.now() - parsingStarted),
				fileCount: input.attachments?.length ?? 0,
			}),
		);
	} catch (error) {
		if (error instanceof SendLimitError)
			return NextResponse.json(
				{ error: error.message, code: error.code },
				{ status: error.status },
			);
		if (error instanceof z.ZodError)
			return NextResponse.json({ error: z.flattenError(error) }, { status: 400 });
		const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
		return NextResponse.json(
			{ error: status === 413 ? "Send request is too large" : "Invalid send request" },
			{ status },
		);
	}
	const { attachments, ...fields } = input;
	const parsed = sendEmailSchema.omit({ attachments: true }).safeParse(fields);
	if (!parsed.success) {
		return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
	}

	try {
		const { forwardMessageId, ...message } = parsed.data;
		const forward = forwardMessageId ? await getForwardSource(env, user, forwardMessageId) : null;
		if (forwardMessageId && !forward) {
			return NextResponse.json(
				{ error: "The message you are forwarding is no longer available" },
				{ status: 404 },
			);
		}
		const result = await queueEmail(
			env,
			{
				userId: user.id,
				...message,
				attachments,
				forward,
			},
			{
				idempotencyKey: request.headers.get("Idempotency-Key"),
				undoDelaySeconds: parseUndoSendDelay(request.headers.get("X-Undo-Send-Delay-Seconds")),
			},
		);
		return NextResponse.json(result, {
			status:
				result.status === "scheduled" || result.status === "queued" || result.status === "sending"
					? 202
					: 200,
			headers: { "Idempotency-Key": result.idempotencyKey },
		});
	} catch (err) {
		if (err instanceof SendLimitError)
			return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
		const message = err instanceof Error ? err.message : "Send failed";
		const status = err instanceof IdempotencyConflictError ? 409 : getSendErrorStatus(message);
		return NextResponse.json({ error: message }, { status });
	}
}
