import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { requireUser } from "@/lib/auth/cookies";
import { buildSnippet } from "@/lib/email/parse";
import type { DraftPayload, DraftRouteParams } from "./types";
import { selectDraftWithBody } from "./utils";
import { readJsonBody } from "@/lib/http/request";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { getDraftSender, userOwnsDraft } from "../utils";
import { buildOutboundThreading } from "@/lib/email/threading";
import { requestDraftDeletion } from "@/lib/storage/lifecycle";

export async function GET(request: Request, { params }: DraftRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	const db = getDb(env);
	const draft = await selectDraftWithBody(db, user.id, id);

	if (!draft) {
		return NextResponse.json({ error: "Draft not found" }, { status: 404 });
	}

	return NextResponse.json({ draft });
}

export async function PATCH(request: Request, { params }: DraftRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	let input: DraftPayload;
	try {
		input = await readJsonBody<DraftPayload>(request, 1024 * 1024);
	} catch (error) {
		const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
		return NextResponse.json({ error: "Invalid draft request" }, { status });
	}
	const db = getDb(env);
	const [draft] = await db.select().from(messages).where(eq(messages.id, id)).limit(1);

	if (!userOwnsDraft(draft, user.id)) {
		return NextResponse.json({ error: "Draft not found" }, { status: 404 });
	}
	const sender = await getDraftSender(env, user.id, input);
	if ("error" in sender) {
		return NextResponse.json({ error: sender.error }, { status: 403 });
	}

	const text = input.text ?? "";
	const html = input.html ?? "";
	let threading: Awaited<ReturnType<typeof buildOutboundThreading>>;
	try {
		threading =
			input.replyToMessageId || !draft.threadId || !draft.providerMessageId
				? await buildOutboundThreading(db, {
						messageId: id,
						mailboxId: sender.mailboxId,
						fromAddr: sender.fromAddr,
						replyToMessageId: input.replyToMessageId,
					})
				: {
						providerMessageId: draft.providerMessageId,
						inReplyTo: null,
						references: "[]",
						replyToMessageId: null,
						threadId: draft.threadId,
						headers: {},
					};
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Invalid reply message" },
			{ status: 400 },
		);
	}
	await db
		.update(messages)
		.set({
			mailboxId: sender.mailboxId,
			fromAddr: sender.fromAddr,
			providerMessageId: threading.providerMessageId,
			inReplyTo: threading.inReplyTo,
			references: threading.references,
			replyToMessageId: threading.replyToMessageId,
			threadId: threading.threadId,
			toAddr: input.to ?? "",
			ccAddr: input.cc ?? "",
			subject: input.subject ?? null,
			snippet: buildSnippet(text || null, html || null),
			textBody: text || null,
			htmlBody: html || null,
		})
		.where(eq(messages.id, id));

	return NextResponse.json({ draft: { id } });
}

export async function DELETE(request: Request, { params }: DraftRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	const result = await requestDraftDeletion(env, user.id, id);
	if (result.outcome === "not_found" || result.outcome === "not_allowed") {
		return NextResponse.json({ error: "Draft not found" }, { status: 404 });
	}
	return NextResponse.json(
		{ ok: true, jobId: result.jobId, status: result.completed ? "completed" : "pending" },
		{ status: result.completed ? 200 : 202 },
	);
}
