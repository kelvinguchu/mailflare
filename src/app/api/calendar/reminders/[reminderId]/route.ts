import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { cancelCalendarReminder, updateCalendarReminder } from "@/lib/calendar/reminders";
import type { CalendarReminderPatchInput } from "@/lib/calendar/types";
import { CalendarInputError } from "@/lib/calendar/validation";
import type { CalendarReminderRouteParams } from "../types";

export async function PATCH(request: Request, { params }: CalendarReminderRouteParams) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	try {
		const { reminderId } = await params;
		const input = (await request.json()) as CalendarReminderPatchInput;
		return NextResponse.json({
			reminder: await updateCalendarReminder(env, user, reminderId, input),
		});
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}

export async function DELETE(request: Request, { params }: CalendarReminderRouteParams) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	try {
		const { reminderId } = await params;
		return NextResponse.json({
			reminder: await cancelCalendarReminder(env, user.id, reminderId),
		});
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}
