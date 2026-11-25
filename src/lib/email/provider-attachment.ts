import type { AttachmentContent } from "./attachment-types";
import { normalizeContentId } from "./inline-parts";

/**
 * One part for the Email Service `send()` builder, which writes the MIME tree from each part's
 * disposition, Content-ID and file name. An inline part keeps its file name and goes with a
 * bare Content-ID (`logo@example.com`), the form Cloudflare documents and the HTML's `cid:`
 * uses. IDs read from received mail carry angle brackets, which could otherwise reach the wire
 * doubled and stop the HTML matching its image. A part marked inline without an ID cannot be
 * referenced, so it goes as an ordinary attachment.
 */
export function toEmailServiceAttachment(attachment: AttachmentContent) {
	const contentId =
		attachment.disposition === "inline" ? normalizeContentId(attachment.contentId) : null;
	return contentId
		? {
				disposition: "inline" as const,
				contentId,
				filename: attachment.filename,
				type: attachment.type,
				content: attachment.content,
			}
		: {
				disposition: "attachment" as const,
				filename: attachment.filename,
				type: attachment.type,
				content: attachment.content,
			};
}
