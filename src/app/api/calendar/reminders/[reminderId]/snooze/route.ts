import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { snoozeCalendarReminder } from "@/lib/calendar/reminders";
import type { CalendarReminderRouteParams, CalendarSnoozeInput } from "../../types";
import { CalendarInputError } from "@/lib/calendar/validation";

export async function POST(request: Request, { params }: CalendarReminderRouteParams) {
	const env = getEnv();
	const user = await requireUser(env, request);
	try {
		const { reminderId } = await params;
		const input = (await request.json()) as CalendarSnoozeInput;
		return NextResponse.json({
			reminder: await snoozeCalendarReminder(env, user.id, reminderId, input.until),
		});
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}
