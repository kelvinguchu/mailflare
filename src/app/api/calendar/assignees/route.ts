import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { listCalendarTaskAssignees } from "@/lib/calendar/tasks";
import { getEnv } from "@/lib/cloudflare";

export async function GET(request: Request) {
	const env = getEnv();
	if (!(await getCurrentUser(env, request))) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	return NextResponse.json({ assignees: await listCalendarTaskAssignees(env) });
}
