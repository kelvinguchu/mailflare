import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { parseCalendarInvitations } from "@/lib/calendar/ical";
import { findImportedEvent } from "@/lib/calendar/import";
import { CalendarInputError } from "@/lib/calendar/validation";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { readCalendarImportSource } from "../source";

export async function POST(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	try {
		const { content, options } = await readCalendarImportSource(env, user, request);
		const meetings = await Promise.all(
			parseCalendarInvitations(content, options.timezone).map(async (meeting) => {
				const existing = meeting.uid ? await findImportedEvent(env, user.id, meeting) : null;
				return {
					...meeting,
					existingSequence: existing?.sequence ?? null,
					existingTitle: existing?.title ?? null,
				};
			}),
		);
		return NextResponse.json({ meetings }, { headers: { "Cache-Control": "private, no-store" } });
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
