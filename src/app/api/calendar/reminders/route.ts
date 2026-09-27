import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { createCalendarReminder, listCalendarReminders } from "@/lib/calendar/reminders";
import type { CalendarReminderInput, CalendarReminderStatus } from "@/lib/calendar/types";
import { CalendarInputError, calendarInstant } from "@/lib/calendar/validation";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	try {
		const url = new URL(request.url);
		const start = optionalRangeDate(url.searchParams.get("start"), "a reminder range start");
		const end = optionalRangeDate(url.searchParams.get("end"), "a reminder range end");
		if (start && end && end <= start) {
			throw new CalendarInputError("Reminder range end must be after its start");
		}
		const reminders = await listCalendarReminders(env, user.id, {
			status: reminderStatus(url.searchParams.get("status")),
			due: url.searchParams.get("due") === "true",
			eventId: url.searchParams.get("eventId") ?? undefined,
			taskId: url.searchParams.get("taskId") ?? undefined,
			start,
			end,
		});
		return NextResponse.json({ reminders });
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}

export async function POST(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	try {
		const input = (await request.json()) as CalendarReminderInput;
		const reminder = await createCalendarReminder(env, user, input);
		return NextResponse.json({ reminder }, { status: 201 });
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}

function reminderStatus(value: string | null): CalendarReminderStatus | "all" {
	if (!value || value === "scheduled") return "scheduled";
	if (
		value === "processing" ||
		value === "delivered" ||
		value === "dismissed" ||
		value === "cancelled" ||
		value === "failed" ||
		value === "all"
	) {
		return value;
	}
	throw new CalendarInputError("Invalid reminder status");
}

function optionalRangeDate(value: string | null, label: string): Date | null {
	return calendarInstant(value, { allDay: false, label, optional: true });
}
