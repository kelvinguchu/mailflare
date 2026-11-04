import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/types";
import { getEmailAddress } from "@/lib/email/address";
import { getAuthorizedAttachment } from "@/lib/email/attachments";
import { detectPreviewType, normalizeMimeType } from "@/lib/email/preview";
import { readFormDataBody, readJsonBody } from "@/lib/http/request";
import { MAX_ICS_BYTES } from "@/lib/calendar/ical";
import type { CalendarImportOptions } from "@/lib/calendar/import";
import { CalendarInputError } from "@/lib/calendar/validation";
import { z } from "zod";

const importOptionsSchema = z.object({
	index: z.number().int().min(0).max(19).optional(),
	timezone: z.string().max(100).optional(),
	confirmed: z.boolean().optional(),
	expectedSequence: z.number().int().nonnegative().nullable().optional(),
	title: z.string().max(200).optional(),
	description: z.string().max(10000).optional(),
	location: z.string().max(500).optional(),
	attendees: z.array(z.email()).max(100).optional(),
	addReminder: z.boolean().optional(),
	messageId: z.string().max(200).optional(),
	attachmentId: z.string().max(200).optional(),
});

function readOptions(value: unknown): CalendarImportOptions {
	const result = importOptionsSchema.safeParse(value);
	if (!result.success) throw new CalendarInputError("Invalid invitation options");
	return result.data;
}

export async function readCalendarImportSource(
	env: CloudflareEnv,
	user: SessionUser,
	request: Request,
) {
	let content: string;
	let options: CalendarImportOptions;
	let sourceSender: string | null = null;
	if (request.headers.get("Content-Type")?.includes("multipart/form-data")) {
		const form = await readFormDataBody(request, MAX_ICS_BYTES + 16 * 1024);
		const file = form.get("file");
		if (!(file instanceof File) || file.size > MAX_ICS_BYTES)
			throw new CalendarInputError("Choose a calendar file smaller than 256 KiB", 413);
		if (!/\.ics$/i.test(file.name) && normalizeMimeType(file.type) !== "text/calendar")
			throw new CalendarInputError("Choose an ICS invitation");
		content = await file.text();
		options = readOptions(JSON.parse(String(form.get("options") ?? "{}")));
	} else {
		options = readOptions(await readJsonBody<unknown>(request, 16 * 1024));
		if (!options.messageId || !options.attachmentId)
			throw new CalendarInputError("Choose an invitation attachment");
		const attachment = await getAuthorizedAttachment(
			env,
			user,
			options.messageId,
			options.attachmentId,
		);
		if (!attachment) throw new CalendarInputError("Invitation not found", 404);
		if (attachment.size > MAX_ICS_BYTES)
			throw new CalendarInputError("Invitation is too large", 413);
		const object = await env.BUCKET.get(attachment.r2Key);
		if (!object) throw new CalendarInputError("Invitation not found", 404);
		if (object.size > MAX_ICS_BYTES) {
			await object.body.cancel();
			throw new CalendarInputError("Invitation is too large", 413);
		}
		content = await object.text();
		const [message] = await getDb(env)
			.select({ from: messages.fromAddr, direction: messages.direction })
			.from(messages)
			.where(eq(messages.id, options.messageId))
			.limit(1);
		if (message?.direction === "inbound")
			sourceSender = getEmailAddress(message.from).toLowerCase();
	}
	if (!options || typeof options !== "object" || Array.isArray(options))
		throw new CalendarInputError("Invalid invitation options");
	if (
		detectPreviewType(new TextEncoder().encode(content.slice(0, 512)), "text/calendar") !==
		"text/calendar"
	)
		throw new CalendarInputError("Malformed calendar invitation");
	return { content, options, sourceSender };
}
