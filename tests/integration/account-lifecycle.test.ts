import { beforeEach, describe, expect, it } from "vitest";
import {
	archiveAccount,
	deleteArchivedAccount,
	resetAccountForInvitation,
	transferMailboxOwnership,
} from "@/lib/accounts/lifecycle";
import { createAccountExport } from "@/lib/accounts/export";
import { verifyPassword } from "@/lib/auth/password";
import { integrationEnv } from "./bindings";
import { createMailEnv, fixtureIds, resetIntegrationState, seedMailboxWorld } from "./fixtures";

const createdAt = 1_700_000_000;

beforeEach(async () => {
	await resetIntegrationState();
	await seedMailboxWorld();
});

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let length = 0;
	const reader = stream.getReader();
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) break;
		chunks.push(chunk.value);
		length += chunk.value.byteLength;
	}
	const result = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

describe("account lifecycle", () => {
	it("resets an active account, revokes credentials, clears MFA, and creates an audit record", async () => {
		await integrationEnv.DB.batch([
			integrationEnv.DB.prepare(
				"UPDATE users SET mfa_secret_encrypted = 'secret', mfa_enabled_at = ? WHERE id = ?",
			).bind(createdAt, fixtureIds.delegate),
			integrationEnv.DB.prepare(
				"INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES ('sess_reset', ?, 'hash_reset', 4000000000, ?)",
			).bind(fixtureIds.delegate, createdAt),
			integrationEnv.DB.prepare(
				"INSERT INTO api_keys (id, user_id, name, prefix, key_hash, scopes, created_at) VALUES ('key_reset', ?, 'Reset key', 'cc_test', 'key_hash', '[]', ?)",
			).bind(fixtureIds.delegate, createdAt),
		]);
		const result = await resetAccountForInvitation(createMailEnv(), {
			accountId: fixtureIds.delegate,
			actorUserId: fixtureIds.owner,
			invitationEmail: "delegate-recovery@example.test",
			confirmation: "reset delegate@external.test",
		});
		expect(result.invitation.status).toBe("delivery_disabled");
		const account = await integrationEnv.DB.prepare(
			"SELECT password_hash, activation_status, reset_email, mfa_secret_encrypted FROM users WHERE id = ?",
		)
			.bind(fixtureIds.delegate)
			.first<{
				password_hash: string;
				activation_status: string;
				reset_email: string;
				mfa_secret_encrypted: string | null;
			}>();
		expect(account).toMatchObject({
			activation_status: "pending",
			reset_email: "delegate-recovery@example.test",
			mfa_secret_encrypted: null,
		});
		expect(verifyPassword("hash", account!.password_hash)).toBe(false);
		expect(
			await integrationEnv.DB.prepare("SELECT count(*) AS count FROM sessions WHERE user_id = ?")
				.bind(fixtureIds.delegate)
				.first(),
		).toEqual({ count: 0 });
		expect(
			await integrationEnv.DB.prepare("SELECT count(*) AS count FROM api_keys WHERE user_id = ?")
				.bind(fixtureIds.delegate)
				.first(),
		).toEqual({ count: 0 });
		expect(
			await integrationEnv.DB.prepare(
				"SELECT action FROM audit_logs WHERE target_user_id = ? AND action = 'account.reset_for_reinvitation'",
			)
				.bind(fixtureIds.delegate)
				.first(),
		).toEqual({ action: "account.reset_for_reinvitation" });
	});

	it("transfers a mailbox while preserving full access for its previous owner", async () => {
		await transferMailboxOwnership(createMailEnv(), {
			mailboxId: fixtureIds.sharedMailbox,
			newOwnerUserId: fixtureIds.delegate,
			actorUserId: fixtureIds.owner,
			confirmation: "transfer support@primary.test",
		});
		expect(
			await integrationEnv.DB.prepare("SELECT user_id FROM mailboxes WHERE id = ?")
				.bind(fixtureIds.sharedMailbox)
				.first(),
		).toEqual({ user_id: fixtureIds.delegate });
		expect(
			await integrationEnv.DB.prepare(
				"SELECT permission FROM mailbox_access WHERE mailbox_id = ? AND user_id = ?",
			)
				.bind(fixtureIds.sharedMailbox, fixtureIds.owner)
				.first(),
		).toEqual({ permission: "full_access" });
	});

	it("archives with a successor, reassigns retained work, then permits deletion", async () => {
		await integrationEnv.DB.batch([
			integrationEnv.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(
				fixtureIds.stranger,
			),
			integrationEnv.DB.prepare(
				`INSERT INTO calendar_tasks
				 (id, user_id, assignee_user_id, title, status, priority, timezone, all_day, description, created_at, updated_at)
				 VALUES ('task_transition', ?, ?, 'Transition work', 'open', 'high', 'UTC', 0, '', ?, ?)`,
			).bind(fixtureIds.owner, fixtureIds.owner, createdAt, createdAt),
			integrationEnv.DB.prepare(
				`INSERT INTO messages
				 (id, user_id, mailbox_id, direction, from_addr, to_addr, status, security_status, spam_score, read, starred, created_at)
				 VALUES ('msg_transition', ?, ?, 'inbound', 'a@example.test', 'support@primary.test', 'received', 'clean', 0, 0, 0, ?)`,
			).bind(fixtureIds.owner, fixtureIds.sharedMailbox, createdAt),
		]);

		const result = await archiveAccount(createMailEnv(), {
			accountId: fixtureIds.owner,
			actorUserId: fixtureIds.stranger,
			successorUserId: fixtureIds.delegate,
			confirmation: "archive owner@primary.test",
		});
		expect(result.transferred.mailboxes).toBe(2);
		expect(
			await integrationEnv.DB.prepare(
				"SELECT disabled, archived_at, activation_status FROM users WHERE id = ?",
			)
				.bind(fixtureIds.owner)
				.first(),
		).toMatchObject({ disabled: 1, activation_status: "revoked" });
		expect(
			await integrationEnv.DB.prepare(
				"SELECT user_id, assignee_user_id FROM calendar_tasks WHERE id = 'task_transition'",
			).first(),
		).toEqual({ user_id: fixtureIds.delegate, assignee_user_id: fixtureIds.delegate });
		expect(
			await integrationEnv.DB.prepare(
				"SELECT user_id FROM messages WHERE id = 'msg_transition'",
			).first(),
		).toEqual({ user_id: fixtureIds.delegate });

		await deleteArchivedAccount(createMailEnv(), {
			accountId: fixtureIds.owner,
			actorUserId: fixtureIds.stranger,
			confirmation: "delete owner@primary.test",
		});
		expect(
			await integrationEnv.DB.prepare("SELECT id FROM users WHERE id = ?")
				.bind(fixtureIds.owner)
				.first(),
		).toBeNull();
		const deletionAudit = await integrationEnv.DB.prepare(
			"SELECT target_user_id, metadata FROM audit_logs WHERE action = 'account.deleted'",
		).first<{ target_user_id: string | null; metadata: string }>();
		expect(deletionAudit?.target_user_id).toBeNull();
		expect(deletionAudit?.metadata).toContain(fixtureIds.owner);
	});

	it("protects the last active administrator", async () => {
		await expect(
			archiveAccount(createMailEnv(), {
				accountId: fixtureIds.owner,
				actorUserId: fixtureIds.stranger,
				successorUserId: fixtureIds.delegate,
				confirmation: "archive owner@primary.test",
			}),
		).rejects.toMatchObject({ status: 409 });
	});

	it("streams a tar package containing database records and referenced R2 objects", async () => {
		await integrationEnv.BUCKET.put("avatars/users/usr_owner", "avatar-data", {
			httpMetadata: { contentType: "image/png" },
		});
		await integrationEnv.DB.prepare("UPDATE users SET avatar_key = ? WHERE id = ?")
			.bind("avatars/users/usr_owner", fixtureIds.owner)
			.run();
		const archive = await readStream(await createAccountExport(createMailEnv(), fixtureIds.owner));
		const text = new TextDecoder().decode(archive);
		expect(text).toContain("database/account.json");
		expect(text).toContain("owner@primary.test");
		expect(text).toContain("r2-index.json");
		expect(text).toContain("avatars/users/usr_owner");
		expect(text).toContain("avatar-data");
		expect(text).not.toContain("password_hash");
	});
});
