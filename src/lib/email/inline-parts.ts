/**
 * Inline parts are images a message body shows itself, such as a signature logo. They travel
 * as `Content-Disposition: inline` parts with a `Content-ID` that the HTML points at with
 * `cid:`, and mail apps draw them in place instead of listing them as attachments.
 */

/** `<logo@example.com>` and ` logo@example.com ` both become `logo@example.com`. */
export function normalizeContentId(value: string | null | undefined): string | null {
	const trimmed = value?.trim().replace(/^<+/, "").replace(/>+$/, "").trim();
	return trimmed ? trimmed : null;
}

/** Whether the HTML draws this content ID, the same test the viewer uses to show it. */
export function htmlReferencesContentId(
	html: string | null | undefined,
	contentId: string | null | undefined,
): boolean {
	const id = normalizeContentId(contentId);
	if (!html || !id) return false;
	return html.includes(`cid:${id}`);
}

/**
 * How a parsed part is stored. A part is inline only when the HTML draws it and the sender did
 * not explicitly ask for an attachment; anything else, including an "inline" part the HTML
 * never references, is something the reader needs to see in the attachment list.
 */
export function classifyPartDisposition(
	part: { disposition?: string | null; contentId?: string | null },
	html: string | null | undefined,
): "inline" | "attachment" {
	if (part.disposition?.trim().toLowerCase() === "attachment") return "attachment";
	return htmlReferencesContentId(html, part.contentId) ? "inline" : "attachment";
}

/** An inline part the body already shows, so it is not repeated as an attachment. */
export function isEmbeddedInlinePart(
	part: { disposition: string; contentId: string | null },
	html: string | null | undefined,
): boolean {
	return part.disposition === "inline" && htmlReferencesContentId(html, part.contentId);
}

/** The attachments a reader should see listed under a message. */
export function getListedAttachments<T extends { disposition: string; contentId: string | null }>(
	attachments: readonly T[],
	html: string | null | undefined,
): T[] {
	return attachments.filter((attachment) => !isEmbeddedInlinePart(attachment, html));
}
