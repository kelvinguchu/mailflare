import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { createCalendarTask, listCalendarTasks } from "@/lib/calendar/tasks";
import type {
	CalendarTaskInput,
	CalendarTaskScope,
	CalendarTaskStatus,
} from "@/lib/calendar/types";
import { CalendarInputError, calendarInstant } from "@/lib/calendar/validation";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	try {
		const url = new URL(request.url);
		const status = taskStatus(url.searchParams.get("status"));
		const start = optionalRangeDate(url.searchParams.get("start"), "a task range start");
		const end = optionalRangeDate(url.searchParams.get("end"), "a task range end");
		if (start && end && end <= start) {
			throw new CalendarInputError("Task range end must be after its start");
		}
		const tasks = await listCalendarTasks(env, user, {
			status,
			scope: taskScope(url.searchParams.get("scope")),
			overdue: url.searchParams.get("overdue") === "true",
			start,
			end,
		});
		return NextResponse.json({ tasks });
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}

function taskScope(value: string | null): CalendarTaskScope {
	if (!value || value === "assigned") return "assigned";
	if (value === "created" || value === "all") return value;
	throw new CalendarInputError("Task scope must be assigned, created, or all");
}

export async function POST(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	try {
		const input = (await request.json()) as CalendarTaskInput;
		const task = await createCalendarTask(env, user, input);
		return NextResponse.json({ task }, { status: 201 });
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}

function taskStatus(value: string | null): CalendarTaskStatus | "all" {
	if (!value || value === "open") return "open";
	if (value === "completed" || value === "all") return value;
	throw new CalendarInputError("Task status must be open, completed, or all");
}

function optionalRangeDate(value: string | null, label: string): Date | null {
	return calendarInstant(value, { allDay: false, label, optional: true });
}
