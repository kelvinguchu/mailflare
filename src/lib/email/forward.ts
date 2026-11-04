import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messageAttachments, messages } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/types";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import type { AttachmentContent } from "./attachment-types";
import { MAX_ATTACHMENT_COUNT, MAX_TOTAL_ATTACHMENT_SIZE } from "./limits";
import { signatureHtmlToText } from "./signatures";

/**
 * A forward keeps the original email's format: its HTML, inline images and
 * attachments, under the usual "Forwarded message" header. The server builds it
 * from the stored message, so the original never has to pass through the browser.
 */

const FORWARD_TIME_ZONE = "Africa/Nairobi";

type StoredMessage = typeof messages.$inferSelect;
type StoredAttachment = typeof messageAttachments.$inferSelect;

export type ForwardSource = { message: StoredMessage; attachments: StoredAttachment[] };

export type ForwardedContent = {
	html: string;
	text: string;
	attachments: AttachmentContent[];
};

/** The message to forward, if this user may read it; same rule as opening its attachments. */
export async function getForwardSource(
	env: CloudflareEnv,
	user: SessionUser,
	messageId: string,
): Promise<ForwardSource | null> {
	const db = getDb(env);
	const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
	if (
		!message ||
		message.employeeHiddenAt ||
		message.consumedByMessageId ||
		message.securityStatus === "quarantined"
	)
		return null;
	if (message.mailboxId) {
		const access = await getMailboxAccessLevel(db, user, message.mailboxId);
		if (!access?.canRead) return null;
	} else if (message.userId !== user.id) {
		return null;
	}
	const attachments = await db
		.select()
		.from(messageAttachments)
		.where(eq(messageAttachments.messageId, messageId));
	return { message, attachments };
}

const escapeHtml = (value: string) =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");

/** The original's body and styles, without what must not travel inside another email. */
export function embeddableEmailHtml(html: string): string {
	const withoutScripts = html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "");
	const styles = withoutScripts.match(/<style\b[\s\S]*?<\/style\s*>/gi) ?? [];
	const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(withoutScripts)?.[1];
	const content =
		body ??
		withoutScripts
			.replace(/<!doctype[^>]*>/gi, "")
			.replace(/<head\b[\s\S]*?<\/head\s*>/gi, "")
			.replace(/<\/?html\b[^>]*>/gi, "")
			.replace(/<style\b[\s\S]*?<\/style\s*>/gi, "");
	return `<div>${styles.join("")}${content.replace(/<base\b[^>]*>/gi, "")}</div>`;
}

function headerLines(message: StoredMessage): Array<[string, string]> {
	const date = new Intl.DateTimeFormat("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZone: FORWARD_TIME_ZONE,
	}).format(message.createdAt);
	return [
		["From", message.fromAddr],
		["Date", date],
		["Subject", message.subject ?? "(no subject)"],
		["To", message.toAddr],
		...(message.ccAddr ? ([["Cc", message.ccAddr]] as Array<[string, string]>) : []),
	];
}

/** What fits in the remaining send allowance. Inline images come first: the body needs them. */
export function chooseForwardAttachments<T extends { size: number; disposition: string }>(
	attachments: T[],
	used: { count: number; bytes: number },
): { included: T[]; omitted: T[] } {
	const ordered = [...attachments].sort(
		(a, b) => Number(b.disposition === "inline") - Number(a.disposition === "inline"),
	);
	const included: T[] = [];
	const omitted: T[] = [];
	let { count, bytes } = used;
	for (const attachment of ordered) {
		if (count + 1 <= MAX_ATTACHMENT_COUNT && bytes + attachment.size <= MAX_TOTAL_ATTACHMENT_SIZE) {
			included.push(attachment);
			count += 1;
			bytes += attachment.size;
		} else {
			omitted.push(attachment);
		}
	}
	return { included, omitted };
}

/**
 * Builds the forwarded part, which follows the sender's note and signature. Anything
 * too large to send is named in the header, so nobody assumes it came through.
 */
export async function renderForwardedContent(
	env: Pick<CloudflareEnv, "BUCKET">,
	source: ForwardSource,
	alreadySending: AttachmentContent[],
): Promise<ForwardedContent> {
	const { message } = source;
	const clean = source.attachments.filter(
		(attachment) => attachment.securityStatus !== "quarantined",
	);
	const { included, omitted } = chooseForwardAttachments(clean, {
		count: alreadySending.length,
		bytes: alreadySending.reduce((sum, file) => sum + file.content.byteLength, 0),
	});
	const loaded = await Promise.all(
		included.map(async (attachment): Promise<AttachmentContent | null> => {
			const object = await env.BUCKET.get(attachment.r2Key);
			if (!object) return null;
			return {
				filename: attachment.filename,
				type: attachment.contentType,
				content: await object.arrayBuffer(),
				disposition: attachment.disposition === "inline" ? "inline" : "attachment",
				...(attachment.contentId ? { contentId: attachment.contentId } : {}),
			};
		}),
	);
	const notIncluded = omitted.map((item) => item.filename);

	const lines = headerLines(message);
	const omittedNote = notIncluded.length
		? `Attachments not included (too large to forward): ${notIncluded.join(", ")}`
		: null;
	const headerHtml = [
		"---------- Forwarded message ---------",
		...lines.map(([label, value]) => `<strong>${label}:</strong> ${escapeHtml(value)}`),
		...(omittedNote ? [`<em>${escapeHtml(omittedNote)}</em>`] : []),
	].join("<br>");
	const body = message.htmlBody?.trim()
		? embeddableEmailHtml(message.htmlBody)
		: `<div>${escapeHtml(message.textBody ?? "").replace(/\n/g, "<br>")}</div>`;
	const textBody =
		message.textBody?.trim() ||
		(message.htmlBody ? (signatureHtmlToText(message.htmlBody) ?? "") : "");

	return {
		html: `<br><div style="color: #5f6368; font-size: 13px">${headerHtml}</div><br>${body}`,
		text: [
			"",
			"",
			"---------- Forwarded message ---------",
			...lines.map(([label, value]) => `${label}: ${value}`),
			...(omittedNote ? [omittedNote] : []),
			"",
			textBody.trim(),
			"",
		].join("\n"),
		attachments: loaded.filter((item): item is AttachmentContent => item !== null),
	};
}
