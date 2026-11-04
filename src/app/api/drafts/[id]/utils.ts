import { employeeVisible } from "@/lib/team-inboxes/retention";
import { and, eq } from "drizzle-orm";
import type { getDb } from "@/db";
import { messages } from "@/db/schema";

type Db = ReturnType<typeof getDb>;

export function selectDraftWithBody(db: Db, userId: string, draftId: string) {
	return db
		.select({
			id: messages.id,
			userId: messages.userId,
			mailboxId: messages.mailboxId,
			fromAddr: messages.fromAddr,
			toAddr: messages.toAddr,
			ccAddr: messages.ccAddr,
			revision: messages.draftRevision,
			subject: messages.subject,
			status: messages.status,
			replyToMessageId: messages.replyToMessageId,
			textBody: messages.textBody,
			htmlBody: messages.htmlBody,
		})
		.from(messages)
		.where(and(employeeVisible(), eq(messages.id, draftId)))
		.limit(1)
		.then(([draft]) =>
			draft && draft.userId === userId && draft.status === "draft" ? draft : null,
		);
}
