import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getDraftSender, userOwnsDraft } from "@/app/api/drafts/utils";
import { buildOutboundThreading } from "@/lib/email/threading";
import { readFormDataBody, readJsonBody } from "@/lib/http/request";
import { validateAttachments, listMessageAttachments } from "@/lib/email/attachments";
import { buildSnippet } from "@/lib/email/parse";
import { newId } from "@/lib/ids";
import type { AttachmentContent } from "@/lib/email/attachment-types";
import type { DraftPayload } from "@/app/api/drafts/types";
import type { SessionUser } from "@/lib/auth/types";
import { z } from "zod";
const schema = z.object({
	mailboxId: z.string().nullable().optional(),
	from: z.string().max(1000).optional(),
	to: z.string().max(16000).optional(),
	cc: z.string().max(16000).optional(),
	subject: z.string().max(16000).optional(),
	text: z
		.string()
		.max(1024 * 1024)
		.optional(),
	html: z
		.string()
		.max(1024 * 1024)
		.optional(),
	replyToMessageId: z.string().nullable().optional(),
	revision: z.number().int().nonnegative().optional(),
});
export async function saveInspectedDraft(
	env: CloudflareEnv,
	user: SessionUser,
	request: Request,
	id?: string,
) {
	let input: DraftPayload & { revision?: number }, files: AttachmentContent[] | undefined;
	try {
		if (request.headers.get("Content-Type")?.includes("multipart/form-data")) {
			const form = await readFormDataBody(request, 8 * 1024 * 1024);
			input = schema.parse(JSON.parse(String(form.get("payload") ?? "{}")));
			files = await Promise.all(
				form.getAll("attachments").map(async (file) => {
					if (typeof file === "string") throw new Error("Invalid file");
					return {
						filename: file.name,
						type: file.type || "application/octet-stream",
						content: await file.arrayBuffer(),
					};
				}),
			);
			validateAttachments(files);
		} else input = schema.parse(await readJsonBody(request, 1024 * 1024));
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : "Invalid draft" },
			{ status: 400 },
		);
	}
	const db = getDb(env);
	const [existing] = id ? await db.select().from(messages).where(eq(messages.id, id)).limit(1) : [];
	if (id && !userOwnsDraft(existing, user.id))
		return Response.json({ error: "Draft not found" }, { status: 404 });
	const sender = await getDraftSender(env, user.id, input);
	if ("error" in sender) return Response.json({ error: sender.error }, { status: 403 });
	const draftId = id ?? newId("msg"),
		token = newId("save");
	const revision = input.revision ?? existing?.draftRevision ?? 0;
	let threading;
	try {
		threading = await buildOutboundThreading(db, {
			messageId: draftId,
			mailboxId: sender.mailboxId,
			fromAddr: sender.fromAddr,
			replyToMessageId: input.replyToMessageId,
		});
	} catch {
		return Response.json({ error: "Invalid reply" }, { status: 400 });
	}
	const oldFiles = files
		? (
				await env.DB.prepare("SELECT r2_key FROM message_attachments WHERE message_id = ?")
					.bind(draftId)
					.all<{ r2_key: string }>()
			).results
		: [];
	const uploaded: { id: string; key: string; file: AttachmentContent }[] = [];
	try {
		for (const file of files ?? []) {
			const attachmentId = newId("att");
			const filename = file.filename.replace(/[/\\\x00-\x1f]/g, "_");
			const key = `attachments/${draftId}/${attachmentId}/${filename}`;
			const stored = await env.BUCKET.put(key, file.content, {
				httpMetadata: { contentType: file.type },
			});
			if (!stored || stored.size !== file.content.byteLength) {
				await env.BUCKET.delete(key);
				throw new Error("Attachment upload was not confirmed");
			}
			uploaded.push({ id: attachmentId, key, file: { ...file, filename } });
		}
		const values = {
			mailboxId: sender.mailboxId,
			fromAddr: sender.fromAddr,
			toAddr: input.to ?? "",
			ccAddr: input.cc ?? "",
			subject: input.subject ?? null,
			textBody: input.text ?? null,
			htmlBody: input.html ?? null,
			snippet: buildSnippet(input.text ?? null, input.html ?? null),
			providerMessageId: threading.providerMessageId,
			inReplyTo: threading.inReplyTo,
			references: threading.references,
			replyToMessageId: threading.replyToMessageId,
			threadId: threading.threadId,
			draftRevision: revision + 1,
			draftSaveToken: token,
		};
		const columns: Record<string, string> = {
			mailboxId: "mailbox_id",
			fromAddr: "from_addr",
			toAddr: "to_addr",
			ccAddr: "cc_addr",
			subject: "subject",
			textBody: "text_body",
			htmlBody: "html_body",
			snippet: "snippet",
			providerMessageId: "provider_message_id",
			inReplyTo: "in_reply_to",
			references: '"references"',
			replyToMessageId: "reply_to_message_id",
			threadId: "thread_id",
			draftRevision: "draft_revision",
			draftSaveToken: "draft_save_token",
		};
		const entries = Object.entries(values),
			bindings = entries.map(([, value]) => value ?? null);
		const first = existing
			? env.DB.prepare(
					`UPDATE messages SET ${entries.map(([key]) => `${columns[key]} = ?`).join(", ")} WHERE id = ? AND user_id = ? AND status = 'draft' AND draft_revision = ? AND employee_hidden_at IS NULL AND consumed_by_message_id IS NULL`,
				).bind(...bindings, draftId, user.id, revision)
			: env.DB.prepare(
					`INSERT INTO messages (${entries.map(([key]) => columns[key]).join(", ")}, id, user_id, direction, status, read, created_at) VALUES (${entries.map(() => "?").join(", ")}, ?, ?, 'outbound', 'draft', 1, unixepoch())`,
				).bind(...bindings, draftId, user.id);
		const statements = [first];
		if (files)
			statements.push(
				env.DB.prepare(
					"DELETE FROM message_attachments WHERE message_id = ? AND EXISTS(SELECT 1 FROM messages WHERE id = ? AND draft_save_token = ?)",
				).bind(draftId, draftId, token),
				...uploaded.map((item) =>
					env.DB.prepare(
						"INSERT INTO message_attachments (id, message_id, filename, content_type, size, disposition, security_status, r2_key, created_at) SELECT ?, ?, ?, ?, ?, 'attachment', 'safe', ?, unixepoch() WHERE EXISTS(SELECT 1 FROM messages WHERE id = ? AND draft_save_token = ?)",
					).bind(
						item.id,
						draftId,
						item.file.filename,
						item.file.type,
						item.file.content.byteLength,
						item.key,
						draftId,
						token,
					),
				),
			);
		const saved = await env.DB.batch(statements);
		if (!saved[0].meta.changes) {
			await Promise.all(uploaded.map((item) => env.BUCKET.delete(item.key)));
			return Response.json(
				{ error: "Draft changed or was discarded. Reload before saving." },
				{ status: 409 },
			);
		}
		if (files) {
			// Only remove keys that no retained message references, including a concurrent discard.
			for (const item of oldFiles) {
				const used = await env.DB.prepare("SELECT 1 FROM message_attachments WHERE r2_key = ?")
					.bind(item.r2_key)
					.first();
				if (!used) await env.BUCKET.delete(item.r2_key);
			}
		}
		return Response.json({
			draft: { id: draftId, revision: revision + 1 },
			attachments: await listMessageAttachments(env, draftId),
		});
	} catch (error) {
		for (const item of uploaded) {
			const used = await env.DB.prepare("SELECT 1 FROM message_attachments WHERE r2_key = ?")
				.bind(item.key)
				.first();
			if (!used) await env.BUCKET.delete(item.key);
		}
		return Response.json(
			{ error: error instanceof Error ? error.message : "Draft could not be saved" },
			{ status: 503 },
		);
	}
}
