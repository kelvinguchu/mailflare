import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/cookies";
import { listCalendarTaskActivity } from "@/lib/calendar/tasks";
import { CalendarInputError } from "@/lib/calendar/validation";
import { getEnv } from "@/lib/cloudflare";
import type { CalendarTaskRouteParams } from "../../types";

export async function GET(request: Request, { params }: CalendarTaskRouteParams) {
	const env = getEnv();
	const user = await requireUser(env, request);
	try {
		const { taskId } = await params;
		return NextResponse.json({ activity: await listCalendarTaskActivity(env, user, taskId) });
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}
