import { listMessageAttachments } from "@/lib/email/attachments";
import { saveInspectedDraft } from "@/lib/team-inboxes/drafts";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/cookies";
import type { DraftRouteParams } from "./types";
import { selectDraftWithBody } from "./utils";
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

	return NextResponse.json({
		draft: { ...draft, attachments: await listMessageAttachments(env, id) },
	});
}

export async function PATCH(request: Request, { params }: DraftRouteParams) {
	const env = getEnv();
	const user = await requireUser(env, request);
	const { id } = await params;
	return saveInspectedDraft(env, user, request, id);
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
