import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { parseCalendarInvitations } from "@/lib/calendar/ical";
import { confirmCalendarImport } from "@/lib/calendar/import";
import { CalendarInputError } from "@/lib/calendar/validation";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { readCalendarImportSource } from "./source";

export async function POST(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	try {
		const { content, options, sourceSender } = await readCalendarImportSource(env, user, request);
		const meetings = parseCalendarInvitations(content, options.timezone);
		if (!Number.isInteger(options.index) || options.index! < 0 || !meetings[options.index!])
			throw new CalendarInputError("Choose a meeting to import");
		const result = await confirmCalendarImport(
			env,
			user,
			meetings[options.index!],
			options,
			sourceSender,
		);
		return NextResponse.json(result);
	} catch (error) {
		if (error instanceof CalendarInputError)
			return NextResponse.json({ error: error.message }, { status: error.status });
		if (error instanceof RequestBodyTooLargeError)
			return NextResponse.json({ error: "Invitation is too large" }, { status: 413 });
		if (error instanceof SyntaxError)
			return NextResponse.json({ error: "Malformed invitation request" }, { status: 400 });
		throw error;
	}
}
