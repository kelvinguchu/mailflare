import { getDb } from "@/db";
import { messages, messageAttachments, outboundJobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createOutboundRequestHash } from "@/lib/email/outbound-idempotency";

export function draftContentFingerprint(input: Parameters<typeof createOutboundRequestHash>[0]) {
	return createOutboundRequestHash({
		...input,
		headers: undefined,
		text: input.text || undefined,
		html: input.html || undefined,
	});
}

/** Consume only a snapshot whose entire saved content exists in an accepted outbound record. */
export async function consumeSentDraft(
	env: CloudflareEnv,
	userId: string,
	draftId: string,
	messageId: string,
) {
	const db = getDb(env);
	const [draft] = await db
		.select()
		.from(messages)
		.where(and(eq(messages.id, draftId), eq(messages.userId, userId)))
		.limit(1);
	if (
		!draft ||
		draft.status !== "draft" ||
		draft.employeeHiddenAt ||
		draft.consumedByMessageId ||
		!draft.mailboxId
	)
		return false;
	const [job] = await db
		.select()
		.from(outboundJobs)
		.where(and(eq(outboundJobs.messageId, messageId), eq(outboundJobs.userId, userId)))
		.limit(1);
	if (!job || job.status === "failed" || job.status === "canceled") return false;
	let acceptedHash: unknown;
	try {
		acceptedHash = (JSON.parse(job.payload) as { draftContentHash?: unknown }).draftContentHash;
	} catch {
		return false;
	}
	if (typeof acceptedHash !== "string") return false;
	const files = await db
		.select()
		.from(messageAttachments)
		.where(eq(messageAttachments.messageId, draftId));
	const attachments: Parameters<typeof createOutboundRequestHash>[0]["attachments"] = [];
	for (const file of files) {
		const object = await env.BUCKET.get(file.r2Key);
		if (!object) return false;
		attachments.push({
			filename: file.filename,
			type: file.contentType,
			content: await object.arrayBuffer(),
			disposition: file.disposition as "attachment" | "inline",
			contentId: file.contentId,
		});
	}
	const hash = await draftContentFingerprint({
		from: draft.fromAddr,
		to: draft.toAddr,
		cc: draft.ccAddr ?? undefined,
		subject: draft.subject ?? "",
		text: draft.textBody ?? undefined,
		html: draft.htmlBody ?? undefined,
		mailboxId: draft.mailboxId,
		replyToMessageId: draft.replyToMessageId,
		attachments,
	});
	if (hash !== acceptedHash) return false;
	const result = await env.DB.prepare(
		"UPDATE messages SET consumed_by_message_id = ?, draft_revision = draft_revision + 1 WHERE id = ? AND user_id = ? AND draft_revision = ? AND status = 'draft' AND employee_hidden_at IS NULL AND consumed_by_message_id IS NULL",
	)
		.bind(messageId, draftId, userId, draft.draftRevision)
		.run();
	return !!result.meta.changes;
}
