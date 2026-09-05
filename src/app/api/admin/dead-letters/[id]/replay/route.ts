import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import {
	DeadLetterNotFoundError,
	DeadLetterReplayBlockedError,
	replayDeadLetterEvent,
} from "@/lib/queues/dead-letters";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const env = getEnv();
	let actorUserId: string;
	try {
		const user = await requireUser(env, request);
		assertAdmin(user);
		actorUserId = user.id;
	} catch {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	try {
		const { id } = await params;
		const result = await replayDeadLetterEvent(env, id, actorUserId);
		return NextResponse.json(result);
	} catch (error) {
		if (error instanceof DeadLetterNotFoundError) {
			return NextResponse.json({ error: error.message }, { status: 404 });
		}
		if (error instanceof DeadLetterReplayBlockedError) {
			return NextResponse.json({ error: error.message }, { status: 409 });
		}
		console.error(JSON.stringify({ event: "dead_letter_replay_failed", errorCode: "REPLAY_FAILED" }));
		return NextResponse.json({ error: "Failed to replay this delivery" }, { status: 500 });
	}
}
