import { getDb } from "@/db";
import type { SessionUser } from "@/lib/auth/types";
import { getAuthorizedSenderAddress } from "@/lib/email/sender";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import { CalendarInputError } from "./validation";

export async function requireCalendarMailboxAccess(
	env: CloudflareEnv,
	user: SessionUser,
	mailboxId: string | null | undefined,
): Promise<void> {
	if (!mailboxId) return;
	const access = await getMailboxAccessLevel(getDb(env), user, mailboxId);
	if (!access) throw new CalendarInputError("Calendar mailbox not found", 404);
}

export async function requireCalendarSender(
	env: CloudflareEnv,
	user: SessionUser,
	mailboxId: string | null | undefined,
	from: string | null | undefined,
): Promise<{ mailboxId: string; fromAddr: string }> {
	if (!mailboxId || !from?.trim()) {
		throw new CalendarInputError("Email reminders require a mailbox and sender address");
	}
	try {
		const sender = await getAuthorizedSenderAddress(env, {
			userId: user.id,
			mailboxId,
			from,
		});
		return { mailboxId: sender.mailboxId, fromAddr: sender.fromAddr };
	} catch (error) {
		throw new CalendarInputError(
			error instanceof Error ? error.message : "Calendar sender is not authorized",
			403,
		);
	}
}
