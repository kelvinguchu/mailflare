import { and, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { messages, messageDeletionEvents } from "@/db/schema";
import { newId } from "@/lib/ids";
import { inspectionOwnerEmail } from "./policy";
import type { SessionUser } from "@/lib/auth/types";
type Message = typeof messages.$inferSelect;
export const employeeVisible = () =>
	and(isNull(messages.employeeHiddenAt), isNull(messages.consumedByMessageId));
export function isRetainedTeamMessage(env: CloudflareEnv, message: Message): boolean {
	const owner = inspectionOwnerEmail(env);
	return !(
		owner &&
		message.originalUserEmail?.toLowerCase() === owner &&
		message.originalMailboxType === "personal"
	);
}
export async function recordDeletionEvent(
	env: CloudflareEnv,
	message: Message,
	action: string,
	actor: Pick<SessionUser, "id" | "email"> | null,
) {
	await getDb(env)
		.insert(messageDeletionEvents)
		.values({
			id: newId("mde"),
			messageId: message.id,
			actorUserId: actor?.id ?? null,
			actorEmail: actor?.email ?? null,
			action,
			fromStatus: message.status,
			fromFolderName: message.deletionOriginalFolderName,
		});
}
export async function hideRetainedMessage(
	env: CloudflareEnv,
	message: Message,
	actor: Pick<SessionUser, "id" | "email"> | null,
	action: string,
) {
	const now = Math.floor(Date.now() / 1000);
	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO message_deletion_events (id, message_id, actor_user_id, actor_email, action, from_status, from_folder_name, created_at) SELECT ?, id, ?, ?, ?, status, deletion_original_folder_name, ? FROM messages WHERE id = ? AND employee_hidden_at IS NULL",
		).bind(newId("mde"), actor?.id ?? null, actor?.email ?? null, action, now, message.id),
		env.DB.prepare(
			"UPDATE messages SET employee_hidden_at = ?, deletion_original_status = coalesce(deletion_original_status, status), draft_revision = draft_revision + 1 WHERE id = ? AND employee_hidden_at IS NULL",
		).bind(now, message.id),
	]);
	return { outcome: "accepted" as const, completed: true, jobId: `retained_${message.id}` };
}
