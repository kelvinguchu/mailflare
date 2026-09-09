import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkEnvironmentIsolation } from "./check-environment-isolation.mjs";

const CONFIRMATION = "mailflare-staging";
const BASE_URL = "https://mailflare-staging.agabio.workers.dev";
const BUCKET = "mailflare-raw-staging";
const wranglerPath = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

if (process.env.CC_MAIL_STAGING_RESTORE_DRILL !== CONFIRMATION) {
	throw new Error(`Set CC_MAIL_STAGING_RESTORE_DRILL=${CONFIRMATION} to run the destructive staging-only drill`);
}

const { staging } = checkEnvironmentIsolation();
if (staging.name !== CONFIRMATION || staging.vars?.DEPLOYMENT_ENV !== "staging") {
	throw new Error("The configured target is not the isolated staging environment");
}

const runId = `drill_${new Date().toISOString().replaceAll(/[-:.TZ]/g, "").slice(0, 14)}_${randomBytes(4).toString("hex")}`;
const ids = {
	user: `usr_${runId}`,
	domain: `dom_${runId}`,
	mailbox: `mbx_${runId}`,
	message: `msg_${runId}`,
	inlineAttachment: `att_inline_${runId}`,
	fileAttachment: `att_file_${runId}`,
	session: `ses_${runId}`,
};
const sessionToken = `sess_${randomBytes(32).toString("base64url")}`;
const tokenHash = createHash("sha256").update(sessionToken).digest("hex");
const now = Math.floor(Date.now() / 1000);
const cookie = `ep_session=${sessionToken}`;
const email = `${runId}@restore-drill.invalid`;
const original = {
	userName: "Restore Drill Original User",
	messageSubject: "Restore Drill Original Message",
	companyName: "Restore Drill Original Company",
};
const mutated = {
	userName: "Restore Drill Mutated User",
	messageSubject: "Restore Drill Mutated Message",
	companyName: "Restore Drill Mutated Company",
};

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);
const objects = [
	{ key: `restore-drill/${runId}/users/avatar.png`, contentType: "image/png", original: png },
	{ key: `restore-drill/${runId}/mailboxes/avatar.png`, contentType: "image/png", original: png },
	{ key: `restore-drill/${runId}/branding/icon.png`, contentType: "image/png", original: png },
	{
		key: `restore-drill/${runId}/raw/message.eml`,
		contentType: "message/rfc822",
		original: Buffer.from("From: sender@example.invalid\r\nTo: restore-drill@example.invalid\r\nSubject: Restore drill\r\n\r\nOriginal raw body\r\n"),
	},
	{ key: `restore-drill/${runId}/inline/pixel.png`, contentType: "image/png", original: png },
	{
		key: `restore-drill/${runId}/attachments/proof.txt`,
		contentType: "text/plain",
		original: Buffer.from("CC Mail staging restore drill attachment\n"),
	},
].map((object) => ({
	...object,
	mutated: Buffer.from(`mutated:${object.key}`),
}));

const cleanupKeys = new Set(objects.map(({ key }) => key));
const recoveryIds = new Set();
let baselineAppSettings;
let backupId;
let failureRecoveryId;
let successRecoveryId;
let completed = false;
let mutationStarted = false;

function runWrangler(args, options = {}) {
	const result = spawnSync(process.execPath, [wranglerPath, ...args], {
		cwd: fileURLToPath(new URL("..", import.meta.url)),
		input: options.input,
		encoding: options.binary ? undefined : "utf8",
		maxBuffer: 20 * 1024 * 1024,
	});
	if (result.error) throw result.error;
	if (result.status !== 0 && !options.allowFailure) {
		const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr;
		throw new Error(`Wrangler failed (${args.slice(0, 3).join(" ")}): ${stderr?.trim() ?? "unknown error"}`);
	}
	return result;
}

function d1(sql) {
	const result = runWrangler([
		"d1", "execute", "DB", "--env", "staging", "--remote", "--command", sql, "--json",
	]);
	const parsed = JSON.parse(result.stdout);
	for (const item of parsed) {
		if (!item.success) throw new Error("D1 command reported failure");
	}
	return parsed;
}

function d1Rows(sql, resultIndex = 0) {
	return d1(sql)[resultIndex]?.results ?? [];
}

function r2Put(object, bytes) {
	runWrangler([
		"r2", "object", "put", `${BUCKET}/${object.key}`, "--env", "staging", "--remote",
		"--pipe", "--content-type", object.contentType, "--force",
	], { input: bytes, binary: true });
}

function r2Get(key, allowFailure = false) {
	const result = runWrangler([
		"r2", "object", "get", `${BUCKET}/${key}`, "--env", "staging", "--remote", "--pipe",
	], { binary: true, allowFailure });
	return result.status === 0 ? Buffer.from(result.stdout) : null;
}

function r2Delete(key) {
	const result = runWrangler([
		"r2", "object", "delete", `${BUCKET}/${key}`, "--env", "staging", "--remote", "--force",
	], { allowFailure: true });
	return result.status === 0;
}

function sql(value) {
	if (value === null) return "NULL";
	if (typeof value === "number") return String(value);
	return `'${String(value).replaceAll("'", "''")}'`;
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function assertBytes(actual, expected, label) {
	assert(actual?.equals(expected), `${label} bytes do not match`);
}

async function api(path, init = {}) {
	return fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { Cookie: cookie, ...(init.headers ?? {}) },
	});
}

async function restore(document) {
	const form = new FormData();
	form.set("backup", new Blob([JSON.stringify(document)], { type: "application/json" }), `${runId}.json`);
	const response = await api("/api/backups/restore", { method: "POST", body: form });
	let body;
	try { body = await response.json(); } catch { body = {}; }
	return { response, body };
}

async function waitForBackup(id) {
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		const response = await api("/api/backups");
		assert(response.ok, `Backup status endpoint returned ${response.status}`);
		const body = await response.json();
		const record = body.backups.find((backup) => backup.id === id);
		if (record?.status === "completed") return record;
		if (record?.status === "failed") throw new Error(`Backup failed: ${record.error ?? "unknown error"}`);
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
	throw new Error("Timed out waiting for the staging backup workflow");
}

function addBundleToCleanup(r2Key, document) {
	cleanupKeys.add(r2Key);
	for (const object of document.r2?.objects ?? []) cleanupKeys.add(object.snapshotKey);
}

function loadBundleForCleanup(r2Key) {
	const bytes = r2Get(r2Key, true);
	if (!bytes) return null;
	const document = JSON.parse(bytes.toString("utf8"));
	addBundleToCleanup(r2Key, document);
	return document;
}

async function preflight() {
	const statusResponse = await fetch(`${BASE_URL}/api/setup/status`);
	assert(statusResponse.ok, `Staging setup status returned ${statusResponse.status}`);
	const status = await statusResponse.json();
	assert(status.hasAdminAccount === false, "Staging already has an administrator; refusing destructive drill");

	const counts = d1Rows(`SELECT
		(SELECT COUNT(*) FROM users) AS users,
		(SELECT COUNT(*) FROM domains) AS domains,
		(SELECT COUNT(*) FROM mailboxes) AS mailboxes,
		(SELECT COUNT(*) FROM messages) AS messages,
		(SELECT COUNT(*) FROM message_attachments) AS attachments,
		(SELECT COUNT(*) FROM sessions) AS sessions,
		(SELECT COUNT(*) FROM backups) AS backups`)[0];
	assert(counts && Object.values(counts).every((value) => value === 0), `Staging is not empty: ${JSON.stringify(counts)}`);
	baselineAppSettings = d1Rows("SELECT * FROM app_settings WHERE id = 'default'")[0];
	assert(baselineAppSettings, "The default app settings row is missing");
}

function seedFixture() {
	for (const object of objects) r2Put(object, object.original);
	const userAvatar = objects[0].key;
	const mailboxAvatar = objects[1].key;
	const icon = objects[2].key;
	const raw = objects[3].key;
	const inline = objects[4];
	const attachment = objects[5];
	d1(`
		INSERT INTO users (id,email,password_hash,name,created_at,reset_email,role,disabled,avatar_key,can_manage_mailboxes)
		VALUES (${sql(ids.user)},${sql(email)},'staging-drill-no-login',${sql(original.userName)},${now},'recovery@restore-drill.invalid','admin',0,${sql(userAvatar)},1);
		INSERT INTO domains (id,user_id,hostname,zone_id,status,sending_enabled,routing_enabled,created_at)
		VALUES (${sql(ids.domain)},${sql(ids.user)},'restore-drill.invalid','staging-drill-zone','active',0,0,${now});
		INSERT INTO mailboxes (id,user_id,domain_id,local_part,display_name,created_at,type,disabled,avatar_key,use_all_domains)
		VALUES (${sql(ids.mailbox)},${sql(ids.user)},${sql(ids.domain)},${sql(runId)},'Restore Drill',${now},'personal',0,${sql(mailboxAvatar)},1);
		INSERT INTO messages (id,user_id,mailbox_id,direction,from_addr,to_addr,subject,snippet,status,created_at,read,starred,text_body,html_body,raw_r2_key,inbound_delivery_key)
		VALUES (${sql(ids.message)},${sql(ids.user)},${sql(ids.mailbox)},'inbound','sender@example.invalid',${sql(email)},${sql(original.messageSubject)},'Original snippet','received',${now},0,0,'Original plain body','<p>Original HTML body</p>',${sql(raw)},${sql(runId)});
		INSERT INTO message_attachments (id,message_id,filename,content_type,size,disposition,content_id,r2_key,created_at)
		VALUES (${sql(ids.inlineAttachment)},${sql(ids.message)},'pixel.png','image/png',${inline.original.length},'inline','restore-drill-pixel',${sql(inline.key)},${now});
		INSERT INTO message_attachments (id,message_id,filename,content_type,size,disposition,content_id,r2_key,created_at)
		VALUES (${sql(ids.fileAttachment)},${sql(ids.message)},'proof.txt','text/plain',${attachment.original.length},'attachment',NULL,${sql(attachment.key)},${now});
		UPDATE app_settings SET icon_key=${sql(icon)}, company_name=${sql(original.companyName)}, updated_at=${now} WHERE id='default';
		INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at)
		VALUES (${sql(ids.session)},${sql(ids.user)},${sql(tokenHash)},${now + 3600},${now});
	`);
}

async function createAndDownloadBackup() {
	const response = await api("/api/backups", { method: "POST" });
	const body = await response.json();
	assert(response.status === 202 && body.backupId, `Backup request failed (${response.status}): ${JSON.stringify(body)}`);
	backupId = body.backupId;
	const record = await waitForBackup(backupId);
	const download = await api(`/api/backups/${backupId}/download`);
	assert(download.ok, `Backup download returned ${download.status}`);
	const document = await download.json();
	assert(document.format === "mailflare-database-backup" && document.version === 4, "Unexpected backup format");
	assert(document.r2?.objects?.length === objects.length, `Expected ${objects.length} R2 snapshots`);
	assert(document.tables.users.some((row) => row.id === ids.user), "Backup omitted the fixture user");
	assert(document.tables.messages.some((row) => row.id === ids.message), "Backup omitted the fixture message");
	assert(document.tables.message_attachments.filter((row) => row.message_id === ids.message).length === 2, "Backup omitted fixture attachments");
	addBundleToCleanup(record.r2Key, document);
	return document;
}

function mutateLiveState() {
	for (const object of objects) r2Put(object, object.mutated);
	d1(`
		UPDATE users SET name=${sql(mutated.userName)} WHERE id=${sql(ids.user)};
		UPDATE messages SET subject=${sql(mutated.messageSubject)} WHERE id=${sql(ids.message)};
		UPDATE app_settings SET company_name=${sql(mutated.companyName)}, updated_at=${now + 1} WHERE id='default';
	`);
}

async function verifyFailureRollback(document) {
	const invalid = structuredClone(document);
	const duplicate = { ...invalid.tables.users.find((row) => row.id === ids.user), id: `usr_duplicate_${runId}`, avatar_key: null };
	invalid.tables.users.push(duplicate);
	const failed = await restore(invalid);
	assert(failed.response.status === 400, `Injected failure unexpectedly returned ${failed.response.status}`);

	const state = d1Rows(`SELECT
		(SELECT name FROM users WHERE id=${sql(ids.user)}) AS user_name,
		(SELECT subject FROM messages WHERE id=${sql(ids.message)}) AS message_subject,
		(SELECT company_name FROM app_settings WHERE id='default') AS company_name,
		(SELECT COUNT(*) FROM sessions WHERE id=${sql(ids.session)}) AS sessions`)[0];
	assert(state.user_name === mutated.userName, "Failed restore changed the live user row");
	assert(state.message_subject === mutated.messageSubject, "Failed restore changed the live message row");
	assert(state.company_name === mutated.companyName, "Failed restore changed app settings");
	assert(state.sessions === 1, "Failed restore invalidated the live session");
	for (const object of objects) assertBytes(r2Get(object.key), object.mutated, `Rolled-back ${object.key}`);

	const recoveries = d1Rows("SELECT id,r2_key FROM backups WHERE id LIKE 'bak_restore_%' ORDER BY created_at DESC");
	assert(recoveries.length === 1, "Injected failure did not leave exactly one recovery backup");
	failureRecoveryId = recoveries[0].id;
	recoveryIds.add(failureRecoveryId);
	assert(loadBundleForCleanup(recoveries[0].r2_key), "Failure recovery bundle is unreadable");
	const authorized = await api("/api/backups");
	assert(authorized.ok, "Failed restore did not preserve the administrator session");
	return failed.body.error ?? "restore rejected";
}

async function verifySuccessfulRestore(document) {
	const restored = await restore(document);
	assert(restored.response.ok && restored.body.ok === true, `Valid restore failed (${restored.response.status}): ${JSON.stringify(restored.body)}`);
	successRecoveryId = restored.body.recoveryBackupId;
	recoveryIds.add(successRecoveryId);

	const state = d1Rows(`SELECT
		(SELECT name FROM users WHERE id=${sql(ids.user)}) AS user_name,
		(SELECT subject FROM messages WHERE id=${sql(ids.message)}) AS message_subject,
		(SELECT company_name FROM app_settings WHERE id='default') AS company_name,
		(SELECT COUNT(*) FROM message_attachments WHERE message_id=${sql(ids.message)}) AS attachments,
		(SELECT COUNT(*) FROM sessions) AS sessions,
		(SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name LIKE '_cc_restore_%') AS staging_tables,
		(SELECT COUNT(*) FROM backups WHERE id=${sql(successRecoveryId)}) AS recovery_backups`)[0];
	assert(state.user_name === original.userName, "User row was not restored");
	assert(state.message_subject === original.messageSubject, "Message row was not restored");
	assert(state.company_name === original.companyName, "App settings were not restored");
	assert(state.attachments === 2, "Attachments were not restored");
	assert(state.sessions === 0, "Sessions were not invalidated");
	assert(state.staging_tables === 0, "Temporary restore tables were not removed");
	assert(state.recovery_backups === 1, "Successful restore recovery backup is missing");
	for (const object of objects) assertBytes(r2Get(object.key), object.original, `Restored ${object.key}`);
	const unauthorized = await api("/api/backups");
	assert(unauthorized.status === 403, `Invalidated session returned ${unauthorized.status}`);

	const recovery = d1Rows(`SELECT r2_key FROM backups WHERE id=${sql(successRecoveryId)}`)[0];
	assert(recovery?.r2_key && loadBundleForCleanup(recovery.r2_key), "Success recovery bundle is unreadable");
}

function restoreBaselineAppSettings() {
	if (!baselineAppSettings) return;
	d1(`UPDATE app_settings SET
		app_name=${sql(baselineAppSettings.app_name)},
		icon_key=${sql(baselineAppSettings.icon_key)},
		updated_at=${sql(baselineAppSettings.updated_at)},
		company_name=${sql(baselineAppSettings.company_name)}
		WHERE id=${sql(baselineAppSettings.id)};`);
}

function cleanup() {
	if (!mutationStarted) return;
	try {
		for (const row of d1Rows("SELECT r2_key FROM backups WHERE r2_key IS NOT NULL")) {
			loadBundleForCleanup(row.r2_key);
		}
	} catch {}
	try {
		d1(`
			DELETE FROM message_attachments WHERE message_id=${sql(ids.message)};
			DELETE FROM messages WHERE id=${sql(ids.message)};
			DELETE FROM sessions WHERE user_id=${sql(ids.user)};
			DELETE FROM mailboxes WHERE id=${sql(ids.mailbox)};
			DELETE FROM domains WHERE id=${sql(ids.domain)};
			DELETE FROM backups;
			DELETE FROM users WHERE id=${sql(ids.user)};
		`);
		restoreBaselineAppSettings();
	} finally {
		const failedDeletes = [];
		for (const key of cleanupKeys) {
			if (!r2Delete(key)) failedDeletes.push(key);
		}
		if (completed && failedDeletes.length > 0) {
			throw new Error(`Could not delete staging drill R2 keys: ${failedDeletes.join(", ")}`);
		}
	}
	if (!completed) return;
	const state = d1Rows(`SELECT
		(SELECT COUNT(*) FROM users) AS users,
		(SELECT COUNT(*) FROM domains) AS domains,
		(SELECT COUNT(*) FROM mailboxes) AS mailboxes,
		(SELECT COUNT(*) FROM messages) AS messages,
		(SELECT COUNT(*) FROM message_attachments) AS attachments,
		(SELECT COUNT(*) FROM sessions) AS sessions,
		(SELECT COUNT(*) FROM backups) AS backups,
		(SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name LIKE '_cc_restore_%') AS restore_tables,
		(SELECT app_name FROM app_settings WHERE id='default') AS app_name,
		(SELECT icon_key FROM app_settings WHERE id='default') AS icon_key,
		(SELECT updated_at FROM app_settings WHERE id='default') AS updated_at,
		(SELECT company_name FROM app_settings WHERE id='default') AS company_name`)[0];
	for (const name of ["users", "domains", "mailboxes", "messages", "attachments", "sessions", "backups", "restore_tables"]) {
		assert(state[name] === 0, `Post-drill cleanup left ${name} rows`);
	}
	for (const name of ["app_name", "icon_key", "updated_at", "company_name"]) {
		assert(state[name] === baselineAppSettings[name], `Post-drill cleanup changed app_settings.${name}`);
	}
}

try {
	await preflight();
	mutationStarted = true;
	seedFixture();
	const document = await createAndDownloadBackup();
	mutateLiveState();
	const injectedFailure = await verifyFailureRollback(document);
	await verifySuccessfulRestore(document);
	completed = true;
	console.log(JSON.stringify({
		result: "passed",
		runId,
		backupId,
		failureRecoveryId,
		successRecoveryId,
		injectedFailure,
		r2ObjectsVerified: objects.length,
		sessionsInvalidated: true,
		temporaryRestoreTablesRemaining: 0,
	}, null, 2));
} finally {
	cleanup();
	if (completed) console.log("Staging drill fixtures and backup bundles cleaned up.");
}
