import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/cookies";
import { listCalendarTaskAssignees } from "@/lib/calendar/tasks";
import { getEnv } from "@/lib/cloudflare";

export async function GET(request: Request) {
	const env = getEnv();
	await requireUser(env, request);
	return NextResponse.json({ assignees: await listCalendarTaskAssignees(env) });
}
