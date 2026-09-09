import type { SessionUser } from "@/lib/auth/types";
import { BACKUP_TABLES } from "@/lib/backups/format";
import { integrationEnv } from "./bindings";

export const fixtureIds = {
	owner: "usr_owner",
	delegate: "usr_delegate",
	stranger: "usr_stranger",
	primaryDomain: "dom_primary",
	aliasDomain: "dom_alias",
	sharedMailbox: "mbx_shared",
	localMailbox: "mbx_local",
} as const;

const createdAt = 1_700_000_000;

export async function resetIntegrationState(): Promise<void> {
	await clearApplicationTables();

	let cursor: string | undefined;
	do {
		const page = await integrationEnv.BUCKET.list({ cursor });
		if (page.objects.length > 0) {
			await integrationEnv.BUCKET.delete(page.objects.map((object) => object.key));
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
}

export async function clearApplicationTables(): Promise<void> {
	await integrationEnv.DB.batch(
		[...BACKUP_TABLES].reverse().map((table) =>
			integrationEnv.DB.prepare(`DELETE FROM ${table}`),
		),
	);
}

export async function seedMailboxWorld(): Promise<void> {
	const db = integrationEnv.DB;
	await db.batch([
		db.prepare(`INSERT INTO users
			(id, email, password_hash, name, role, disabled, can_manage_mailboxes, created_at)
			VALUES (?, ?, ?, ?, ?, 0, 0, ?)`)
			.bind(fixtureIds.owner, "owner@primary.test", "hash", "Owner", "admin", createdAt),
		db.prepare(`INSERT INTO users
			(id, email, password_hash, name, role, disabled, can_manage_mailboxes, created_at)
			VALUES (?, ?, ?, ?, ?, 0, 0, ?)`)
			.bind(fixtureIds.delegate, "delegate@external.test", "hash", "Delegate", "user", createdAt),
		db.prepare(`INSERT INTO users
			(id, email, password_hash, name, role, disabled, can_manage_mailboxes, created_at)
			VALUES (?, ?, ?, ?, ?, 0, 0, ?)`)
			.bind(fixtureIds.stranger, "stranger@external.test", "hash", "Stranger", "user", createdAt),
		db.prepare(`INSERT INTO domains
			(id, user_id, hostname, zone_id, status, sending_enabled, routing_enabled, created_at)
			VALUES (?, ?, ?, ?, 'active', 1, 1, ?)`)
			.bind(fixtureIds.primaryDomain, fixtureIds.owner, "primary.test", "zone-primary", createdAt),
		db.prepare(`INSERT INTO domains
			(id, user_id, hostname, zone_id, status, sending_enabled, routing_enabled, created_at)
			VALUES (?, ?, ?, ?, 'active', 1, 1, ?)`)
			.bind(fixtureIds.aliasDomain, fixtureIds.owner, "alias.test", "zone-alias", createdAt),
		db.prepare(`INSERT INTO mailboxes
			(id, user_id, domain_id, local_part, display_name, type, use_all_domains, disabled,
			 auto_reply_enabled, auto_reply_subject, auto_reply_body, created_at)
			VALUES (?, ?, ?, 'support', 'Support', 'shared', 1, 0, 1, 'Away', 'We will reply soon.', ?)`)
			.bind(fixtureIds.sharedMailbox, fixtureIds.owner, fixtureIds.primaryDomain, createdAt),
		db.prepare(`INSERT INTO mailboxes
			(id, user_id, domain_id, local_part, display_name, type, use_all_domains, disabled, created_at)
			VALUES (?, ?, ?, 'local', 'Local', 'personal', 1, 0, ?)`)
			.bind(fixtureIds.localMailbox, fixtureIds.owner, fixtureIds.primaryDomain, createdAt),
	]);
}

export function sessionUser(id: string): SessionUser {
	const values = {
		[fixtureIds.owner]: { email: "owner@primary.test", name: "Owner", role: "admin" as const },
		[fixtureIds.delegate]: { email: "delegate@external.test", name: "Delegate", role: "user" as const },
		[fixtureIds.stranger]: { email: "stranger@external.test", name: "Stranger", role: "user" as const },
	};
	const value = values[id as keyof typeof values];
	if (!value) throw new Error(`Unknown fixture user: ${id}`);
	return {
		id,
		email: value.email,
		name: value.name,
		role: value.role,
		passwordHash: "hash",
		resetEmail: null,
		resetEmailVerifiedAt: null,
		activationStatus: "active",
		activatedAt: null,
		invitationSentAt: null,
		invitationExpiresAt: null,
		forwardingEmail: null,
		disabled: false,
		canManageMailboxes: false,
		createdByUserId: null,
		createdAt: new Date(createdAt * 1_000),
	};
}

export function createMailEnv(overrides: Partial<CloudflareEnv> = {}): CloudflareEnv {
	return {
		DB: integrationEnv.DB,
		BUCKET: integrationEnv.BUCKET,
		...overrides,
	} as CloudflareEnv;
}
