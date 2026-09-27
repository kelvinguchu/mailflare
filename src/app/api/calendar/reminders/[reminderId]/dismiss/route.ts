import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { dismissCalendarReminder } from "@/lib/calendar/reminders";
import { CalendarInputError } from "@/lib/calendar/validation";
import type { CalendarReminderRouteParams } from "../../types";

export async function POST(request: Request, { params }: CalendarReminderRouteParams) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
