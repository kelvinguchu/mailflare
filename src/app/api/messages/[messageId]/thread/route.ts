import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { messageAttachments, messages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getContactDisplayNameMap } from "@/lib/contacts/service";
import { normalizeEmailAddress } from "@/lib/email/address";
import { buildSnippet } from "@/lib/email/parse";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import type { MessageThreadRouteParams } from "./types";

export async function GET(request: Request, { params }: MessageThreadRouteParams) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const { messageId } = await params;
	const db = getDb(env);
	const [target] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
	if (!target?.mailboxId || target.status === "draft") {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}
	const access = await getMailboxAccessLevel(db, user, target.mailboxId);
	if (!access?.canRead) return NextResponse.json({ error: "Not found" }, { status: 404 });

	const conditions = [
		eq(messages.mailboxId, target.mailboxId),
		ne(messages.status, "draft"),
		target.threadId ? eq(messages.threadId, target.threadId) : eq(messages.id, target.id),
	];
	if (target.status !== "trash") conditions.push(ne(messages.status, "trash"));
	if (target.status !== "spam") conditions.push(ne(messages.status, "spam"));
	const rows = await db
		.select()
		.from(messages)
		.where(and(...conditions))
		.orderBy(asc(messages.createdAt), asc(messages.id));
	const attachmentRows =
		rows.length === 0
			? []
			: await db
					.select({ messageId: messageAttachments.messageId })
					.from(messageAttachments)
					.where(
						inArray(
							messageAttachments.messageId,
							rows.map((row) => row.id),
						),
					)
					.groupBy(messageAttachments.messageId);
	const messagesWithAttachments = new Set(attachmentRows.map((row) => row.messageId));
	const contactMap = await getContactDisplayNameMap(
		env,
		target.userId,
		rows.flatMap((row) => [row.fromAddr, row.toAddr]),
	);
	const mailboxName = access.mailbox.displayName ?? access.mailbox.localPart;
	const responseMessages = rows.map(
		({ rawR2Key: _rawR2Key, textBody: _textBody, htmlBody: _htmlBody, ...message }) => ({
			...message,
			snippet:
				message.securityStatus === "quarantined"
					? "Message quarantined for security review"
					: buildSnippet(_textBody, _htmlBody) || message.snippet,
			fromContactName:
				(message.direction === "outbound" ? mailboxName : null) ??
				contactMap.get(normalizeEmailAddress(message.fromAddr)) ??
				null,
			toContactName: contactMap.get(normalizeEmailAddress(message.toAddr)) ?? null,
			hasAttachments: messagesWithAttachments.has(message.id),
		}),
	);

	return NextResponse.json({
		thread: {
			id: target.threadId ?? target.id,
			subject: rows.find((row) => row.subject?.trim())?.subject ?? target.subject,
			messages: responseMessages,
		},
	});
}
