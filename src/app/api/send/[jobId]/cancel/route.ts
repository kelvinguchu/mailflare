import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { cancelScheduledOutboundJob } from "@/lib/email/undo-send";

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	const { jobId } = await context.params;
	const result = await cancelScheduledOutboundJob(env, user.id, jobId);

	if (result.outcome === "not_found") {
		return NextResponse.json({ error: "Scheduled message not found" }, { status: 404 });
	}
	if (result.outcome === "unavailable") {
		return NextResponse.json(
			{
				error: "Undo is no longer available because delivery has started",
				status: result.status,
				undoDeadline: result.undoDeadline,
			},
			{ status: 409 },
		);
	}
	return NextResponse.json(result);
}
