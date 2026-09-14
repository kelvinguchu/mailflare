type CalendarInvitationInput = {
	title: string;
	description: string;
	location: string;
	startsAt: Date;
	endsAt: Date;
	uid: string;
	stamp?: Date;
	method?: "REQUEST" | "CANCEL";
	organizer?: string | null;
	attendees?: string[];
	sequence?: number;
	status?: "CONFIRMED" | "CANCELLED";
};

function escapeCalendarText(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\r?\n/g, "\\n");
}

function formatCalendarDate(value: Date): string {
	return value
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}/, "");
}

export function createCalendarInvitation(input: CalendarInvitationInput): Uint8Array {
	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//CC Mail//Calendar//EN",
		"CALSCALE:GREGORIAN",
		`METHOD:${input.method ?? "REQUEST"}`,
		"BEGIN:VEVENT",
		`UID:${input.uid}@calibercode.io`,
		`DTSTAMP:${formatCalendarDate(input.stamp ?? new Date())}`,
		`DTSTART:${formatCalendarDate(input.startsAt)}`,
		`DTEND:${formatCalendarDate(input.endsAt)}`,
		`SEQUENCE:${input.sequence ?? 0}`,
		`STATUS:${input.status ?? "CONFIRMED"}`,
		`SUMMARY:${escapeCalendarText(input.title)}`,
		`DESCRIPTION:${escapeCalendarText(input.description)}`,
		`LOCATION:${escapeCalendarText(input.location)}`,
		...(input.organizer ? [`ORGANIZER:mailto:${input.organizer}`] : []),
		...(input.attendees ?? []).map(
			(attendee) => `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${attendee}`,
		),
		"END:VEVENT",
		"END:VCALENDAR",
	];
	return new TextEncoder().encode(lines.join("\r\n"));
}
