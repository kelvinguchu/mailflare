import { createUnusablePasswordHash, prepareAccountActivation } from "@/lib/auth/recovery";
import { disconnectUserRealtime } from "@/lib/auth/session";
import { newId } from "@/lib/ids";

type AccountState = {
	id: string;
	email: string;
	role: "admin" | "user";
	activation_status: "active" | "pending" | "revoked";
	disabled: number;
	archived_at: number | null;
	avatar_key: string | null;
};

type SuccessorState = {
	id: string;
	disabled: number;
	activation_status: "active" | "pending" | "revoked";
	archived_at: number | null;
};

type TransitionCounts = {
	domains: number;
	mailboxes: number;
	messages: number;
	events: number;
	tasks: number;
	assigned_tasks: number;
	reminders: number;
};

type MailboxState = {
	id: string;
	user_id: string;
	address: string;
};

export class AccountLifecycleError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 404 | 409,
	) {
		super(message);
		this.name = "AccountLifecycleError";
	}
}

export type AccountResetResult = {
	invitation: Awaited<ReturnType<typeof prepareAccountActivation>>;
};

function nowSeconds(): number {
	return Math.floor(Date.now() / 1_000);
}

function assertConfirmation(actual: string, expected: string): void {
	if (actual !== expected) {
		throw new AccountLifecycleError(`Type “${expected}” to confirm this action`, 400);
	}
}

async function getAccount(env: CloudflareEnv, accountId: string): Promise<AccountState> {
	const account = await env.DB.prepare(
		`SELECT id, email, role, activation_status, disabled, archived_at, avatar_key
		 FROM users WHERE id = ?`,
	)
		.bind(accountId)
		.first<AccountState>();
	if (!account) throw new AccountLifecycleError("Account not found", 404);
	return account;
}

async function getSuccessor(env: CloudflareEnv, userId: string): Promise<SuccessorState> {
	const user = await env.DB.prepare(
		`SELECT id, disabled, activation_status, archived_at FROM users WHERE id = ?`,
	)
		.bind(userId)
		.first<SuccessorState>();
	if (!user || user.disabled || user.archived_at || user.activation_status !== "active") {
		throw new AccountLifecycleError("The successor must be an active account", 409);
	}
	return user;
}

async function countTransitionData(
	env: CloudflareEnv,
	accountId: string,
): Promise<TransitionCounts> {
	const counts = await env.DB.prepare(
		`SELECT
			(SELECT count(*) FROM domains WHERE user_id = ?) AS domains,
			(SELECT count(*) FROM mailboxes WHERE user_id = ?) AS mailboxes,
			(SELECT count(*) FROM messages WHERE user_id = ?) AS messages,
			(SELECT count(*) FROM calendar_events WHERE user_id = ?) AS events,
			(SELECT count(*) FROM calendar_tasks WHERE user_id = ?) AS tasks,
			(SELECT count(*) FROM calendar_tasks WHERE assignee_user_id = ? AND status = 'open') AS assigned_tasks,
			(SELECT count(*) FROM calendar_reminders WHERE user_id = ?) AS reminders`,
	)
		.bind(accountId, accountId, accountId, accountId, accountId, accountId, accountId)
		.first<TransitionCounts>();
	if (!counts) throw new Error("Could not inspect account transition data");
	return counts;
}

function hasTransferableData(counts: TransitionCounts): boolean {
	return Object.values(counts).some((count) => count > 0);
}

export async function resetAccountForInvitation(
	env: CloudflareEnv,
	input: {
		accountId: string;
		actorUserId: string;
		invitationEmail: string;
		confirmation: string;
	},
): Promise<AccountResetResult> {
	const account = await getAccount(env, input.accountId);
	assertConfirmation(input.confirmation, `reset ${account.email}`);
	if (account.id === input.actorUserId) {
		throw new AccountLifecycleError("You cannot reset your own account", 409);
	}
	if (account.archived_at) {
		throw new AccountLifecycleError("Restore the archived account before resetting it", 409);
	}
	const invitationEmail = input.invitationEmail.trim().toLowerCase();
	if (invitationEmail === account.email.toLowerCase()) {
		throw new AccountLifecycleError("Use an external email address for the invitation", 400);
	}

	const now = nowSeconds();
	try {
		await env.DB.batch([
			env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(account.id),
			env.DB.prepare("DELETE FROM account_recovery_tokens WHERE user_id = ?").bind(account.id),
			env.DB.prepare("DELETE FROM api_keys WHERE user_id = ?").bind(account.id),
			env.DB.prepare(
				`UPDATE users SET password_hash = ?, reset_email = ?, reset_email_verified_at = NULL,
				 activation_status = 'pending', activated_at = NULL, invitation_sent_at = NULL,
				 invitation_expires_at = NULL, mfa_secret_encrypted = NULL, mfa_enabled_at = NULL,
				 mfa_recovery_code_hashes = '[]', mfa_last_used_counter = NULL,
				 mfa_policy_covered_at = NULL, mfa_policy_exempt_until = NULL,
				 mfa_policy_exemption_reason = NULL, mfa_policy_exempted_by_user_id = NULL,
				 disabled = 0
				 WHERE id = ? AND archived_at IS NULL`,
			).bind(createUnusablePasswordHash(), invitationEmail, account.id),
			env.DB.prepare(
				`INSERT INTO audit_logs (id, actor_user_id, target_user_id, action, metadata, created_at)
				 VALUES (?, ?, ?, 'account.reset_for_reinvitation', ?, ?)`,
			).bind(
				newId("aud"),
				input.actorUserId,
				account.id,
				JSON.stringify({
					sessionsRevoked: true,
					apiKeysRevoked: true,
					mfaReset: true,
					invitationEmail,
				}),
				now,
			),
		]);
	} catch (error) {
		if (error instanceof Error && error.message.includes("last active administrator")) {
			throw new AccountLifecycleError("Reset another administrator first", 409);
		}
		throw error;
	}
	await disconnectUserRealtime(env, account.id);
	return { invitation: await prepareAccountActivation(env, account.id) };
}

export async function transferMailboxOwnership(
	env: CloudflareEnv,
	input: {
		mailboxId: string;
		newOwnerUserId: string;
		actorUserId: string;
		confirmation: string;
	},
): Promise<void> {
	const mailbox = await env.DB.prepare(
		`SELECT m.id, m.user_id, m.local_part || '@' || d.hostname AS address
		 FROM mailboxes m JOIN domains d ON d.id = m.domain_id WHERE m.id = ?`,
	)
		.bind(input.mailboxId)
		.first<MailboxState>();
	if (!mailbox) throw new AccountLifecycleError("Mailbox not found", 404);
	assertConfirmation(input.confirmation, `transfer ${mailbox.address}`);
	if (mailbox.user_id === input.newOwnerUserId) {
		throw new AccountLifecycleError("That account already owns this mailbox", 409);
	}
	await getSuccessor(env, input.newOwnerUserId);
	const now = nowSeconds();
	await env.DB.batch([
		env.DB.prepare("DELETE FROM mailbox_access WHERE mailbox_id = ? AND user_id = ?").bind(
			mailbox.id,
			input.newOwnerUserId,
		),
		env.DB.prepare("UPDATE mailboxes SET user_id = ? WHERE id = ? AND user_id = ?").bind(
			input.newOwnerUserId,
			mailbox.id,
			mailbox.user_id,
		),
		env.DB.prepare("UPDATE messages SET user_id = ? WHERE mailbox_id = ?").bind(
			input.newOwnerUserId,
			mailbox.id,
		),
		env.DB.prepare("UPDATE folders SET user_id = ? WHERE mailbox_id = ?").bind(
			input.newOwnerUserId,
			mailbox.id,
		),
		env.DB.prepare(
			`UPDATE outbound_jobs SET user_id = ?, idempotency_key = NULL
			 WHERE message_id IN (SELECT id FROM messages WHERE mailbox_id = ?)`,
		).bind(input.newOwnerUserId, mailbox.id),
		env.DB.prepare("UPDATE signature_assets SET uploaded_by_user_id = ? WHERE mailbox_id = ?").bind(
			input.newOwnerUserId,
			mailbox.id,
		),
		env.DB.prepare(
			`INSERT INTO mailbox_access
			 (id, mailbox_id, user_id, permission, created_by_user_id, created_at)
			 VALUES (?, ?, ?, 'full_access', ?, ?)
			 ON CONFLICT(mailbox_id, user_id) DO UPDATE SET
				permission = 'full_access', created_by_user_id = excluded.created_by_user_id`,
		).bind(newId("mac"), mailbox.id, mailbox.user_id, input.actorUserId, now),
		env.DB.prepare(
			`INSERT INTO audit_logs
			 (id, actor_user_id, target_user_id, mailbox_id, action, metadata, created_at)
			 VALUES (?, ?, ?, ?, 'mailbox.ownership_transferred', ?, ?)`,
		).bind(
			newId("aud"),
			input.actorUserId,
			input.newOwnerUserId,
			mailbox.id,
			JSON.stringify({ previousOwnerUserId: mailbox.user_id, address: mailbox.address }),
			now,
		),
	]);
}

export async function archiveAccount(
	env: CloudflareEnv,
	input: {
		accountId: string;
		actorUserId: string;
		successorUserId?: string;
		confirmation: string;
	},
): Promise<{ transferred: TransitionCounts }> {
	const account = await getAccount(env, input.accountId);
	assertConfirmation(input.confirmation, `archive ${account.email}`);
	if (account.id === input.actorUserId) {
		throw new AccountLifecycleError("You cannot archive your own account", 409);
	}
	if (account.archived_at) throw new AccountLifecycleError("Account is already archived", 409);
	const counts = await countTransitionData(env, account.id);
	if (hasTransferableData(counts) && !input.successorUserId) {
		throw new AccountLifecycleError(
			"Choose an active successor before archiving an account that owns business data",
			409,
		);
	}
	if (input.successorUserId === account.id) {
		throw new AccountLifecycleError("The successor must be a different account", 409);
	}
	if (input.successorUserId) await getSuccessor(env, input.successorUserId);

	const now = nowSeconds();
	const successor = input.successorUserId;
	const statements: D1PreparedStatement[] = [
		env.DB.prepare(
			`UPDATE outbound_jobs SET status = 'canceled', canceled_at = ?, updated_at = ?,
			 error = 'Account archived before delivery'
			 WHERE user_id = ? AND status IN ('scheduled', 'queued') AND delivery_started_at IS NULL`,
		).bind(now, now, account.id),
		env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(account.id),
		env.DB.prepare("DELETE FROM account_recovery_tokens WHERE user_id = ?").bind(account.id),
		env.DB.prepare("DELETE FROM api_keys WHERE user_id = ?").bind(account.id),
		env.DB.prepare("DELETE FROM webhooks WHERE user_id = ?").bind(account.id),
		env.DB.prepare("DELETE FROM sender_policies WHERE user_id = ?").bind(account.id),
		env.DB.prepare("DELETE FROM mailbox_access WHERE user_id = ?").bind(account.id),
	];

	if (successor) {
		statements.push(
			env.DB.prepare(
				"DELETE FROM mailbox_access WHERE user_id = ? AND mailbox_id IN (SELECT id FROM mailboxes WHERE user_id = ?)",
			).bind(successor, account.id),
			env.DB.prepare("UPDATE domains SET user_id = ? WHERE user_id = ?").bind(
				successor,
				account.id,
			),
			env.DB.prepare("UPDATE mailboxes SET user_id = ? WHERE user_id = ?").bind(
				successor,
				account.id,
			),
			env.DB.prepare("UPDATE messages SET user_id = ? WHERE user_id = ?").bind(
				successor,
				account.id,
			),
			env.DB.prepare("UPDATE folders SET user_id = ? WHERE user_id = ?").bind(
				successor,
				account.id,
			),
			env.DB.prepare(
				"UPDATE outbound_jobs SET user_id = ?, idempotency_key = NULL WHERE user_id = ?",
			).bind(successor, account.id),
			env.DB.prepare("UPDATE email_templates SET user_id = ? WHERE user_id = ?").bind(
				successor,
				account.id,
			),
			env.DB.prepare(
				"UPDATE calendar_events SET user_id = ?, idempotency_key = NULL WHERE user_id = ?",
			).bind(successor, account.id),
			env.DB.prepare("UPDATE calendar_tasks SET user_id = ? WHERE user_id = ?").bind(
				successor,
				account.id,
			),
			env.DB.prepare(
				"UPDATE calendar_tasks SET assignee_user_id = ?, assigned_at = ? WHERE assignee_user_id = ? AND status = 'open'",
			).bind(successor, now, account.id),
			env.DB.prepare("UPDATE calendar_reminders SET user_id = ? WHERE user_id = ?").bind(
				successor,
				account.id,
			),
			env.DB.prepare("UPDATE calendar_reminder_deliveries SET user_id = ? WHERE user_id = ?").bind(
				successor,
				account.id,
			),
			env.DB.prepare("UPDATE routing_rules SET user_id = ? WHERE user_id = ?").bind(
				successor,
				account.id,
			),
			env.DB.prepare(
				"UPDATE signature_assets SET uploaded_by_user_id = ? WHERE uploaded_by_user_id = ?",
			).bind(successor, account.id),
		);
	}

	statements.push(
		env.DB.prepare(
			`UPDATE users SET disabled = 1, archived_at = ?, activation_status = 'revoked',
			 invitation_sent_at = NULL, invitation_expires_at = NULL
			 WHERE id = ? AND archived_at IS NULL`,
		).bind(now, account.id),
		env.DB.prepare(
			`INSERT INTO audit_logs
			 (id, actor_user_id, target_user_id, action, metadata, created_at)
			 VALUES (?, ?, ?, 'account.archived', ?, ?)`,
		).bind(
			newId("aud"),
			input.actorUserId,
			account.id,
			JSON.stringify({ successorUserId: successor ?? null, transferred: counts }),
			now,
		),
	);

	try {
		await env.DB.batch(statements);
	} catch (error) {
		if (error instanceof Error && error.message.includes("last active administrator")) {
			throw new AccountLifecycleError("Promote another active administrator first", 409);
		}
		throw error;
	}
	await disconnectUserRealtime(env, account.id);
	return { transferred: counts };
}

export async function deleteArchivedAccount(
	env: CloudflareEnv,
	input: { accountId: string; actorUserId: string; confirmation: string },
): Promise<void> {
	const account = await getAccount(env, input.accountId);
	assertConfirmation(input.confirmation, `delete ${account.email}`);
	if (account.id === input.actorUserId) {
		throw new AccountLifecycleError("You cannot delete your own account", 409);
	}
	if (!account.archived_at) {
		throw new AccountLifecycleError("Archive the account before deleting it", 409);
	}
	const counts = await countTransitionData(env, account.id);
	if (hasTransferableData(counts)) {
		throw new AccountLifecycleError(
			"This account still owns business data; archive it with a successor before deletion",
			409,
		);
	}
	const now = nowSeconds();
	await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO audit_logs (id, actor_user_id, action, metadata, created_at)
			 VALUES (?, ?, 'account.deleted', ?, ?)`,
		).bind(
			newId("aud"),
			input.actorUserId,
			JSON.stringify({
				deletedUserId: account.id,
				email: account.email,
				archivedAt: account.archived_at,
			}),
			now,
		),
		env.DB.prepare("DELETE FROM users WHERE id = ? AND archived_at IS NOT NULL").bind(account.id),
	]);
	if (account.avatar_key) {
		try {
			await env.BUCKET.delete(account.avatar_key);
		} catch (error) {
			console.error(
				JSON.stringify({
					event: "account_avatar_cleanup_failed",
					accountId: account.id,
					error: error instanceof Error ? error.message : "Unknown error",
				}),
			);
		}
	}
	await disconnectUserRealtime(env, account.id);
}
