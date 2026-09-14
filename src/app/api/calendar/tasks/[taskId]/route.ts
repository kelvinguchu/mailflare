import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import {
	deleteCalendarTask,
	requireAccessibleTask,
	updateCalendarTask,
} from "@/lib/calendar/tasks";
import type { CalendarTaskPatchInput } from "@/lib/calendar/types";
import { CalendarInputError } from "@/lib/calendar/validation";
import type { CalendarTaskRouteParams } from "../types";

export async function GET(request: Request, { params }: CalendarTaskRouteParams) {
	const env = getEnv();
	const user = await requireUser(env, request);
	try {
		const { taskId } = await params;
		return NextResponse.json({ task: await requireAccessibleTask(env, user, taskId) });
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}

export async function PATCH(request: Request, { params }: CalendarTaskRouteParams) {
	const env = getEnv();
	const user = await requireUser(env, request);
	try {
		const { taskId } = await params;
		const input = (await request.json()) as CalendarTaskPatchInput;
		return NextResponse.json({ task: await updateCalendarTask(env, user, taskId, input) });
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}

export async function DELETE(request: Request, { params }: CalendarTaskRouteParams) {
	const env = getEnv();
	const user = await requireUser(env, request);
	try {
		const { taskId } = await params;
		await deleteCalendarTask(env, user, taskId);
		return NextResponse.json({ ok: true });
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}
