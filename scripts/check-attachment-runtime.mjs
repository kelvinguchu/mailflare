import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readD1Migrations } from "@cloudflare/vitest-plugin";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
const built = await build({
	entryPoints: ["tests/fixtures/team-attachments-worker.ts"],
	alias: { "@": path.join(process.cwd(), "src") },
	bundle: true,
	write: false,
	platform: "node",
	format: "esm",
	target: "es2022",
	external: ["node:*", "cloudflare:*"],
	logLevel: "warning",
});
const instance = new Miniflare(
	convertV4MiniflareOptions({
		name: "team-attachment-fixture",
		modules: true,
		script: built.outputFiles[0].text,
		compatibilityDate: "2026-05-20",
		compatibilityFlags: ["nodejs_compat"],
		d1Databases: { DB: crypto.randomUUID() },
		r2Buckets: { BUCKET: `team-${crypto.randomUUID()}` },
		d1Persist: false,
		r2Persist: false,
		host: "127.0.0.1",
	}),
);
try {
	const { DB } = await instance.getBindings();
	for (const migration of await readD1Migrations(path.join(process.cwd(), "drizzle/migrations")))
		await DB.batch(migration.queries.map((sql) => DB.prepare(sql)));
	await DB.batch([
		DB.prepare(
			"INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES ('usr_owner','owner@primary.test','hash','Owner','admin',1700000000)",
		),
		DB.prepare(
			"INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES ('usr_stranger','stranger@external.test','hash','Stranger','user',1700000000)",
		),
		DB.prepare(
			"INSERT INTO domains (id,user_id,hostname,zone_id,status,sending_enabled,routing_enabled,created_at) VALUES ('dom_primary','usr_owner','primary.test','zone','active',1,1,1700000000)",
		),
		DB.prepare(
			"INSERT INTO mailboxes (id,user_id,domain_id,local_part,display_name,type,use_all_domains,created_at) VALUES ('mbx_shared','usr_owner','dom_primary','support','Support','shared',0,1700000000)",
		),
	]);
	console.log("Checking send");
	const sent = await instance.dispatchFetch("https://fixture.test/send-case");
	const packet = await sent.json();
	assert.equal(sent.status, 200, JSON.stringify(packet));
	assert.equal(packet.first.messageId, packet.repeated.messageId);
	assert.equal(packet.queued.status, "queued");
	assert.equal(packet.otherUser, null);
	assert.equal(packet.accepted.deliveryStatus, "accepted");
	assert.equal(packet.calls.length, 1);
	assert.deepEqual(packet.sizeError, { code: "E_CONTENT_TOO_LARGE", status: 413 });
	assert.equal(packet.objects, 3);
	assert.equal(packet.attachments.count, 3);
	for (let index = 0; index < 3; index++)
		assert.deepEqual(
			packet.calls[0].find(
				(file) => file.filename === ["one.txt", "report.pdf", "photo.png"][index],
			).bytes,
			[0, 255, index],
		);
	console.log("Checking preview");
	const setup = await (await instance.dispatchFetch("https://fixture.test/preview-setup")).json();
	const preview = `https://fixture.test/preview?preview=1&messageId=${setup.messageId}&attachmentId=${setup.attachmentId}`;
	console.log("Checking range");
	const partial = await instance.dispatchFetch(preview, { headers: { Range: "bytes=9-12" } });
	assert.equal(partial.status, 206);
	assert.equal(await partial.text(), "0123");
	assert.equal(partial.headers.get("Content-Range"), `bytes 9-12/${setup.size}`);
	assert.equal(partial.headers.get("Cache-Control"), "private, no-store");
	const invalid = await instance.dispatchFetch(preview, { headers: { Range: "bytes=100-" } });
	assert.equal(invalid.status, 416);
	await invalid.text();
	const denied = await instance.dispatchFetch(preview, {
		headers: { "X-Test-User": "usr_stranger" },
	});
	assert.equal(denied.status, 404);
	await denied.text();
	await DB.prepare("UPDATE messages SET security_status='quarantined' WHERE id=?")
		.bind(setup.messageId)
		.run();
	const quarantine = await instance.dispatchFetch(preview);
	assert.equal(quarantine.status, 404);
	await quarantine.text();
	console.log(
		"Actual Workers D1/R2 checks passed: multi-file bytes, one job/provider call, final size rejection, ranges and privacy.",
	);
} catch (error) {
	console.error(error);
	throw error;
} finally {
	console.log("Disposing fixture");
	await instance.dispose();
}
