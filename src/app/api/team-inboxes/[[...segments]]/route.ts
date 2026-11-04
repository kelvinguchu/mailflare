import { and, eq } from "drizzle-orm";
import { requireTeamInspector, privateHeaders } from "@/lib/team-inboxes/auth";
import { inspectConversation, inspectMessage, inspectSearch } from "@/lib/team-inboxes/service";
import { createAuditLog } from "@/lib/mailboxes/audit";
import { getDb } from "@/db";
import { messageAttachments } from "@/db/schema";
import { serveStoredAttachment } from "@/lib/email/attachment-response";
import { purgeRetainedMessage } from "@/lib/storage/lifecycle";
import { requireRecentAuthentication } from "@/lib/auth/recent";
import { readJsonBody } from "@/lib/http/request";
import { z } from "zod";
type Context = { params: Promise<{ segments?: string[] }> };
const json = (data: unknown, status = 200) =>
	Response.json(data, { status, headers: privateHeaders });
export async function GET(request: Request, context: Context) {
	return handleRead(request, context);
}
export async function HEAD(request: Request, context: Context) {
	return handleRead(request, context, true);
}
async function handleRead(request: Request, { params }: Context, head = false): Promise<Response> {
	const access = await requireTeamInspector(request);
	if (access.error) return access.error;
	const { env, user } = access;
	const segments = (await params).segments ?? [],
		url = new URL(request.url);
	const audit = (action: string, messageId?: string) =>
		createAuditLog(env, {
			actorUserId: user.id,
			action,
			messageId,
			metadata: {
				mailboxId: url.searchParams.get("mailboxId"),
				scope: url.searchParams.get("mailboxId") ? "mailbox" : "team",
			},
		});
	if (!segments.length) {
		const rows = await env.DB.prepare(
			`SELECT m.id, m.display_name AS name, m.local_part || '@' || d.hostname AS address, m.type, CASE WHEN m.disabled = 1 OR u.disabled = 1 THEN 1 ELSE 0 END AS disabled, u.email AS currentOwnerEmail, u.archived_at AS archivedAt,
 (SELECT original_user_email FROM messages WHERE original_mailbox_id = m.id AND original_user_email <> ? LIMIT 1) AS originalEmployeeEmail
 FROM mailboxes m JOIN domains d ON m.domain_id = d.id JOIN users u ON m.user_id = u.id
 WHERE m.type = 'shared' OR lower(u.email) <> lower(?) OR EXISTS(SELECT 1 FROM messages WHERE original_mailbox_id = m.id AND lower(original_user_email) <> lower(?)) ORDER BY m.display_name, m.local_part`,
		)
			.bind(user.email, user.email, user.email)
			.all();
		return json({ mailboxes: rows.results });
	}
	if (segments[0] === "search") {
		try {
			const result = await inspectSearch(env, url.searchParams);
			if (url.searchParams.get("audit") === "1") await audit("team_mail.search");
			return json(result);
		} catch (error) {
			if (error instanceof Error && /ValidationError$/.test(error.name))
				return json({ error: error.message }, 400);
			throw error;
		}
	}
	if (segments[0] === "folders" && segments[1]) {
		const folders = await env.DB.prepare(
			"SELECT id, name FROM folders WHERE mailbox_id = ? ORDER BY name",
		)
			.bind(segments[1])
			.all();
		return json({ folders: folders.results });
	}
	if (segments[0] === "audit") {
		const result = await env.DB.prepare(
			"SELECT id, action, message_id AS messageId, created_at AS createdAt, metadata FROM audit_logs WHERE action LIKE 'team_mail.%' OR action LIKE 'team_calendar.%' ORDER BY created_at DESC LIMIT 100",
		).all();
		return json({ events: result.results });
	}
	if (segments[0] === "messages" && segments[1]) {
		const id = segments[1],
			data = await inspectMessage(env, id);
		if (!data) return json({ error: "Not found" }, 404);
		if (segments[2] === "attachments" && segments[3]) {
			if (data.message.securityStatus === "quarantined") return json({ error: "Not found" }, 404);
			const [attachment] = await getDb(env)
				.select()
				.from(messageAttachments)
				.where(and(eq(messageAttachments.id, segments[3]), eq(messageAttachments.messageId, id)))
				.limit(1);
			if (!attachment || attachment.securityStatus === "quarantined")
				return json({ error: "Not found" }, 404);
			if (!head) await audit("team_mail.attachment_opened", id);
			return serveStoredAttachment(env, request, attachment, head);
		}
		if (segments[2] === "thread") {
			if (url.searchParams.get("audit") === "1") await audit("team_mail.message_opened", id);
			return json(await inspectConversation(env, id));
		}
		if (url.searchParams.get("audit") === "1") await audit("team_mail.message_opened", id);
		return json(data);
	}
	return json({ error: "Not found" }, 404);
}
export async function POST(request: Request, { params }: Context) {
	const access = await requireTeamInspector(request);
	if (access.error) return access.error;
	const { env, user } = access,
		segments = (await params).segments ?? [];
	if (segments[0] === "session") {
		await createAuditLog(env, { actorUserId: user.id, action: "team_mail.inspection_started" });
		return json({ ok: true });
	}
	return json({ error: "Not found" }, 404);
}
export async function DELETE(request: Request, { params }: Context) {
	const access = await requireTeamInspector(request);
	if (access.error) return access.error;
	const { env, user } = access,
		segments = (await params).segments ?? [];
	if (segments[0] !== "messages" || !segments[1] || segments.length !== 2)
		return json({ error: "Not found" }, 404);
	const authError = await requireRecentAuthentication(env, user.id);
	if (authError) {
		for (const [key, value] of Object.entries(privateHeaders)) authError.headers.set(key, value);
		return authError;
	}
	const schema = z.object({ confirmation: z.literal("permanently-delete-retained-message") });
	try {
		schema.parse(await readJsonBody(request, 4096));
	} catch {
		return json({ error: "Type permanently-delete-retained-message to confirm" }, 400);
	}
	const message = await inspectMessage(env, segments[1]);
	if (!message?.message.employeeHiddenAt)
		return json({ error: "Only removed messages can be permanently removed" }, 409);
	await createAuditLog(env, {
		actorUserId: user.id,
		messageId: segments[1],
		action: "team_mail.permanent_remove_requested",
		metadata: { messageId: segments[1], mailboxAddress: message.message.originalMailboxAddress },
	});
	const result = await purgeRetainedMessage(env, user, segments[1]);
	return json(result, result.outcome === "accepted" ? (result.completed ? 200 : 202) : 409);
}
