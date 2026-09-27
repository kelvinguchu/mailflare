import type { DatabaseRecord } from "@/lib/backups/types";

type ExportSection = {
	name: string;
	sql: string;
	bindings: string[];
};

type ObjectReference = { object_key: string };
type ExportObject = { sourceKey: string; archivePath: string; size: number };

const EXPORT_SECTIONS: ExportSection[] = [
	{
		name: "account",
		sql: `SELECT id, email, reset_email, reset_email_verified_at, forwarding_email, name,
			avatar_key, role, activation_status, activated_at, invitation_sent_at,
			invitation_expires_at, mfa_enabled_at, disabled, archived_at,
			send_rate_limit_per_minute, daily_send_limit, can_manage_mailboxes,
			created_by_user_id, created_at FROM users WHERE id = ?`,
		bindings: ["account"],
	},
	{ name: "domains", sql: "SELECT * FROM domains WHERE user_id = ?", bindings: ["account"] },
	{ name: "mailboxes", sql: "SELECT * FROM mailboxes WHERE user_id = ?", bindings: ["account"] },
	{
		name: "mailbox-access",
		sql: `SELECT * FROM mailbox_access WHERE user_id = ?
			OR mailbox_id IN (SELECT id FROM mailboxes WHERE user_id = ?)`,
		bindings: ["account", "account"],
	},
	{
		name: "signature-assets",
		sql: "SELECT * FROM signature_assets WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE user_id = ?)",
		bindings: ["account"],
	},
	{ name: "contacts", sql: "SELECT * FROM contacts WHERE user_id = ?", bindings: ["account"] },
	{ name: "folders", sql: "SELECT * FROM folders WHERE user_id = ?", bindings: ["account"] },
	{ name: "messages", sql: "SELECT * FROM messages WHERE user_id = ?", bindings: ["account"] },
	{
		name: "message-attachments",
		sql: "SELECT * FROM message_attachments WHERE message_id IN (SELECT id FROM messages WHERE user_id = ?)",
		bindings: ["account"],
	},
	{
		name: "outbound-jobs",
		sql: "SELECT * FROM outbound_jobs WHERE user_id = ?",
		bindings: ["account"],
	},
	{
		name: "api-keys",
		sql: "SELECT id, user_id, name, prefix, scopes, created_at, last_used_at FROM api_keys WHERE user_id = ?",
		bindings: ["account"],
	},
	{
		name: "sender-policies",
		sql: "SELECT * FROM sender_policies WHERE user_id = ?",
		bindings: ["account"],
	},
	{
		name: "email-templates",
		sql: "SELECT * FROM email_templates WHERE user_id = ?",
		bindings: ["account"],
	},
	{
		name: "calendar-events",
		sql: "SELECT * FROM calendar_events WHERE user_id = ?",
		bindings: ["account"],
	},
	{
		name: "calendar-tasks",
		sql: "SELECT * FROM calendar_tasks WHERE user_id = ? OR assignee_user_id = ? OR completed_by_user_id = ?",
		bindings: ["account", "account", "account"],
	},
	{
		name: "calendar-reminders",
		sql: "SELECT * FROM calendar_reminders WHERE user_id = ?",
		bindings: ["account"],
	},
	{
		name: "calendar-reminder-deliveries",
		sql: "SELECT * FROM calendar_reminder_deliveries WHERE user_id = ?",
		bindings: ["account"],
	},
	{
		name: "routing-rules",
		sql: "SELECT * FROM routing_rules WHERE user_id = ?",
		bindings: ["account"],
	},
	{
		name: "webhooks",
		sql: "SELECT id, user_id, url, events, enabled, created_at FROM webhooks WHERE user_id = ?",
		bindings: ["account"],
	},
	{
		name: "sessions",
		sql: "SELECT id, user_id, kind, authenticated_at, expires_at, created_at FROM sessions WHERE user_id = ?",
		bindings: ["account"],
	},
	{
		name: "recovery-tokens",
		sql: "SELECT id, user_id, purpose, email, expires_at, used_at, created_at FROM account_recovery_tokens WHERE user_id = ?",
		bindings: ["account"],
	},
	{
		name: "audit-log",
		sql: "SELECT * FROM audit_logs WHERE actor_user_id = ? OR target_user_id = ? ORDER BY created_at",
		bindings: ["account", "account"],
	},
];

const OBJECT_REFERENCES_SQL = `
	SELECT avatar_key AS object_key FROM users WHERE id = ? AND avatar_key IS NOT NULL
	UNION SELECT avatar_key FROM mailboxes WHERE user_id = ? AND avatar_key IS NOT NULL
	UNION SELECT r2_key FROM signature_assets
		WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE user_id = ?)
	UNION SELECT raw_r2_key FROM messages WHERE user_id = ? AND raw_r2_key IS NOT NULL
	UNION SELECT r2_key FROM message_attachments
		WHERE message_id IN (SELECT id FROM messages WHERE user_id = ?)
`;

function writeString(target: Uint8Array, offset: number, length: number, value: string): void {
	const encoded = new TextEncoder().encode(value);
	target.set(encoded.subarray(0, length), offset);
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number): void {
	writeString(target, offset, length, value.toString(8).padStart(length - 1, "0"));
}

function tarHeader(
	name: string,
	size: number,
	modifiedAt = Math.floor(Date.now() / 1_000),
): Uint8Array {
	const header = new Uint8Array(512);
	writeString(header, 0, 100, name);
	writeOctal(header, 100, 8, 0o600);
	writeOctal(header, 108, 8, 0);
	writeOctal(header, 116, 8, 0);
	writeOctal(header, 124, 12, size);
	writeOctal(header, 136, 12, modifiedAt);
	header.fill(32, 148, 156);
	header[156] = "0".charCodeAt(0);
	writeString(header, 257, 6, "ustar");
	writeString(header, 263, 2, "00");
	let checksum = 0;
	for (const byte of header) checksum += byte;
	writeOctal(header, 148, 7, checksum);
	header[155] = 32;
	return header;
}

function paddingFor(size: number): Uint8Array | null {
	const length = (512 - (size % 512)) % 512;
	return length > 0 ? new Uint8Array(length) : null;
}

function safeObjectName(key: string, index: number): string {
	const leaf =
		key
			.split("/")
			.at(-1)
			?.replace(/[^a-zA-Z0-9._-]/g, "_") || "object.bin";
	return `objects/${String(index + 1).padStart(6, "0")}-${leaf}`.slice(0, 100);
}

async function loadExportObjects(env: CloudflareEnv, accountId: string): Promise<ExportObject[]> {
	const references = await env.DB.prepare(OBJECT_REFERENCES_SQL)
		.bind(accountId, accountId, accountId, accountId, accountId)
		.all<ObjectReference>();
	const objects: ExportObject[] = [];
	for (const [index, reference] of references.results.entries()) {
		const object = await env.BUCKET.head(reference.object_key);
		if (!object) throw new Error(`Account export is missing R2 object: ${reference.object_key}`);
		objects.push({
			sourceKey: reference.object_key,
			archivePath: safeObjectName(reference.object_key, index),
			size: object.size,
		});
	}
	return objects;
}

async function enqueueFile(
	controller: ReadableStreamDefaultController<Uint8Array>,
	name: string,
	content: Uint8Array,
): Promise<void> {
	controller.enqueue(tarHeader(name, content.byteLength));
	controller.enqueue(content);
	const padding = paddingFor(content.byteLength);
	if (padding) controller.enqueue(padding);
	await Promise.resolve();
}

export async function createAccountExport(
	env: CloudflareEnv,
	accountId: string,
): Promise<ReadableStream<Uint8Array>> {
	const objects = await loadExportObjects(env, accountId);
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				await enqueueFile(
					controller,
					"README.txt",
					encoder.encode(
						"CC Mail account export. Authentication secrets, password hashes, API key hashes, webhook secrets, session tokens, and recovery token hashes are intentionally excluded. Database records are JSON files; R2 files are mapped by r2-index.json.\n",
					),
				);
				await enqueueFile(
					controller,
					"r2-index.json",
					encoder.encode(JSON.stringify({ objects }, null, 2)),
				);
				for (const section of EXPORT_SECTIONS) {
					const values = section.bindings.map(() => accountId);
					const result = await env.DB.prepare(section.sql)
						.bind(...values)
						.all<DatabaseRecord>();
					await enqueueFile(
						controller,
						`database/${section.name}.json`,
						encoder.encode(JSON.stringify(result.results, null, 2)),
					);
				}
				for (const objectInfo of objects) {
					const object = await env.BUCKET.get(objectInfo.sourceKey);
					if (!object || object.size !== objectInfo.size) {
						throw new Error(`Account export object changed: ${objectInfo.sourceKey}`);
					}
					controller.enqueue(tarHeader(objectInfo.archivePath, objectInfo.size));
					const reader = object.body.getReader();
					while (true) {
						const chunk = await reader.read();
						if (chunk.done) break;
						controller.enqueue(chunk.value);
					}
					const padding = paddingFor(objectInfo.size);
					if (padding) controller.enqueue(padding);
				}
				controller.enqueue(new Uint8Array(1_024));
				controller.close();
			} catch (error) {
				controller.error(error);
			}
		},
	});
}
