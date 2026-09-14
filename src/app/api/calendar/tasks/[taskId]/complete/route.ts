import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { setCalendarTaskCompleted } from "@/lib/calendar/tasks";
import { CalendarInputError } from "@/lib/calendar/validation";
import type { CalendarTaskRouteParams } from "../../types";

export async function POST(request: Request, { params }: CalendarTaskRouteParams) {
	return setCompleted(request, params, true);
}

export async function DELETE(request: Request, { params }: CalendarTaskRouteParams) {
	return setCompleted(request, params, false);
}

async function setCompleted(
	request: Request,
	params: CalendarTaskRouteParams["params"],
	completed: boolean,
) {
	const env = getEnv();
	const user = await requireUser(env, request);
	try {
		const { taskId } = await params;
		return NextResponse.json({
			task: await setCalendarTaskCompleted(env, user, taskId, completed),
		});
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}
