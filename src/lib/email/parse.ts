import PostalMime from "postal-mime";
import { formatPostalAddress, formatPostalAddressList } from "@/lib/email/address";
import { normalizeAttachmentContent } from "@/lib/email/attachments";
import { getMessagePreviewText, htmlToReadableText } from "@/lib/email/reply-content-utils";
import type { AttachmentContent } from "@/lib/email/attachment-types";
import { classifyPartDisposition } from "@/lib/email/inline-parts";
import { normalizeProviderMessageId, parseMessageReferences } from "@/lib/email/threading";

export type ParsedEmail = {
	subject: string | null;
	text: string | null;
	html: string | null;
	messageId: string | null;
	inReplyTo: string | null;
	references: string[];
	fromAddr: string | null;
	toAddr: string | null;
	ccAddr: string | null;
	date: Date | null;
	attachments: AttachmentContent[];
};

export async function parseRawMime(raw: ArrayBuffer): Promise<ParsedEmail> {
	const email = await PostalMime.parse(raw);
	const date = email.date ? new Date(email.date) : null;
	return {
		subject: email.subject ?? null,
		text: email.text ?? null,
		html: email.html ?? null,
		messageId: normalizeProviderMessageId(email.messageId),
		inReplyTo: parseMessageReferences(email.inReplyTo).at(-1) ?? null,
		references: parseMessageReferences(email.references),
		fromAddr: formatPostalAddress(email.from, null),
		toAddr: formatPostalAddressList(email.to, null),
		ccAddr: formatPostalAddressList(email.cc, null),
		date: date && !Number.isNaN(date.getTime()) ? date : null,
		attachments: email.attachments.map((attachment, index) => ({
			filename: attachment.filename ?? `attachment-${index + 1}`,
			type: attachment.mimeType || "application/octet-stream",
			content: normalizeAttachmentContent(attachment.content, attachment.encoding),
			// Senders often leave out Content-Disposition or file names on inline images, so what
			// counts is whether the HTML draws the part.
			disposition: classifyPartDisposition(attachment, email.html),
			contentId: attachment.contentId ?? null,
		})),
	};
}

export function buildSnippet(text: string | null, html: string | null, max = 200): string {
	// Quoted history and its "On … wrote:" header never belong in a list preview.
	return getMessagePreviewText(text?.trim() || htmlToReadableText(html)).slice(0, max);
}
