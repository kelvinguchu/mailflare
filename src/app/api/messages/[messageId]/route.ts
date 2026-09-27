import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getMessageWithBodyForUser } from "@/lib/email/inbound";
import { readJsonBody } from "@/lib/http/request";
import { requestPermanentMessageDeletion } from "@/lib/storage/lifecycle";
import { z } from "zod";

type MessageRouteParams = {
	params: Promise<{ messageId: string }>;
};

export async function GET(request: Request, { params }: MessageRouteParams) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { messageId } = await params;
	const data = await getMessageWithBodyForUser(env, user, messageId);
	if (!data) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	return NextResponse.json(data);
}

const permanentDeleteSchema = z.object({
	confirmation: z.literal("permanently-delete"),
});

export async function DELETE(request: Request, { params }: MessageRouteParams) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	let body: object;
	try {
		body = await readJsonBody<object>(request, 4 * 1024);
	} catch {
		return NextResponse.json({ error: "Invalid permanent-delete request" }, { status: 400 });
	}
	const parsed = permanentDeleteSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json(
			{ error: 'Set confirmation to "permanently-delete"' },
			{ status: 400 },
		);
	}

	const { messageId } = await params;
	const result = await requestPermanentMessageDeletion(env, user, messageId);
	if (result.outcome === "not_found") {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}
	if (result.outcome === "not_allowed") {
		return NextResponse.json(
			{ error: "Only messages already in trash can be permanently deleted" },
			{ status: 409 },
		);
	}
	return NextResponse.json(
		{ ok: true, jobId: result.jobId, status: result.completed ? "completed" : "pending" },
		{ status: result.completed ? 200 : 202 },
	);
}
