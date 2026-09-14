import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { dismissCalendarReminder } from "@/lib/calendar/reminders";
import { CalendarInputError } from "@/lib/calendar/validation";
import type { CalendarReminderRouteParams } from "../../types";

export async function POST(request: Request, { params }: CalendarReminderRouteParams) {
	const env = getEnv();
	const user = await requireUser(env, request);
	try {
		const { reminderId } = await params;
		return NextResponse.json({
			reminder: await dismissCalendarReminder(env, user.id, reminderId),
		});
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}
