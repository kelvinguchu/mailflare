import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getPlatformProxy, unstable_dev } from "wrangler";
import { readD1Migrations } from "@cloudflare/vitest-plugin";

// Exercise the built Next handler, not only the application's service modules.
// A separate config prevents loading project secrets or connecting live bindings.
const root = process.cwd();
const fixtureRoot = path.join(root, ".wrangler", "worker-runtime-checks");
await fs.mkdir(fixtureRoot, { recursive: true });
const directory = await fs.mkdtemp(path.join(fixtureRoot, "fixture-"));
const configPath = path.join(directory, "wrangler.json");
const name = `mailflare-runtime-${crypto.randomUUID()}`;
const database = { binding: "DB", database_name: name, database_id: crypto.randomUUID() };
const persistence = path.join(directory, "state");
await fs.writeFile(
	configPath,
	JSON.stringify({
		name,
		main: path.join(root, "worker.ts"),
		compatibility_date: "2026-05-20",
		compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
		assets: { binding: "ASSETS", directory: path.join(root, ".open-next", "assets") },
		images: { binding: "IMAGES" },
		services: [{ binding: "WORKER_SELF_REFERENCE", service: name }],
		durable_objects: { bindings: [{ name: "REALTIME", class_name: "RealtimeHub" }] },
		migrations: [{ tag: "v1", new_sqlite_classes: ["RealtimeHub"] }],
		d1_databases: [database],
		r2_buckets: [{ binding: "BUCKET", bucket_name: name }],
		vars: {
			DEPLOYMENT_ENV: "production",
			CLOUDFLARE_MANAGEMENT_MODE: "disabled",
			OUTBOUND_DELIVERY_MODE: "disabled",
			AUTH_EMAIL_DELIVERY_MODE: "disabled",
			PUBLIC_APP_ORIGIN: "http://worker-runtime.invalid",
		},
	}),
);
process.env.OPEN_NEXT_DEPLOY = "true";
let worker;
let platform;
try {
	const seedConfig = path.join(directory, "database.json");
	await fs.writeFile(
		seedConfig,
		JSON.stringify({
			name,
			compatibility_date: "2026-05-20",
			d1_databases: [database],
		}),
	);
	platform = await getPlatformProxy({
		configPath: seedConfig,
		envFiles: [],
		remoteBindings: false,
		persist: { path: path.join(persistence, "v3") },
	});
	const { DB } = platform.env;
	for (const migration of await readD1Migrations(path.join(root, "drizzle", "migrations")))
		await DB.batch(migration.queries.map((sql) => DB.prepare(sql)));
	await DB.prepare(
		"INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES ('fixture_admin','admin@runtime.test','fixture-only','Fixture Admin','admin',1700000000)",
	).run();
	await platform.dispose();
	platform = undefined;
	worker = await unstable_dev(path.join(root, "worker.ts"), {
		config: configPath,
		local: true,
		ip: "127.0.0.1",
		port: 0,
		inspectorPort: 0,
		envFiles: [],
		persistTo: persistence,
		logLevel: "error",
		experimental: {
			forceLocal: true,
			disableDevRegistry: true,
			watch: false,
			showInteractiveDevSession: false,
			disableExperimentalWarning: true,
		},
	});
	const request = (url) =>
		worker.fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30000) });
	console.log("Checking packaged sign-in");
	const login = await request("/login");
	const html = await login.text();
	assert.equal(login.status, 200, `Cold login failed: ${html.slice(-2000)}`);
	assert.ok(html.includes('type="password"'), "Built sign-in form is missing");
	assert.ok(login.headers.get("content-security-policy")?.includes("frame-src 'self' blob:"));
	for (const [url, expected] of [
		["/", 307],
		["/api/accounts/domains", 403],
		["/api/calendar/events", 401],
		["/api/send?idempotencyKey=runtime-fixture", 401],
	]) {
		const response = await request(url);
		const body = await response.text();
		assert.equal(response.status, expected, `${url}: ${body.slice(-2000)}`);
		if (url === "/")
			assert.equal(
				new URL(response.headers.get("location"), "http://fixture.test").pathname,
				"/login",
			);
	}
	const concurrent = await Promise.all(Array.from({ length: 3 }, () => request("/login")));
	for (const response of concurrent) {
		assert.equal(response.status, 200, "Concurrent sign-in request failed");
		await response.arrayBuffer();
	}
	const assets = [
		...new Set(
			[...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?]+\.(?:js|css))/g)].map(
				(match) => match[1],
			),
		),
	];
	assert.ok(assets.length >= 2, "Built static assets are missing");
	for (const asset of assets.slice(0, 4)) {
		const response = await request(asset);
		assert.equal(response.status, 200, `Missing built asset ${asset}`);
		assert.ok((await response.arrayBuffer()).byteLength > 0);
	}
	console.log(
		"Packaged Worker runtime passed: cold/concurrent sign-in, protected APIs, static assets and CSP.",
	);
} finally {
	await worker?.stop();
	await platform?.dispose();
	const resolved = path.resolve(directory);
	assert.ok(resolved.startsWith(path.resolve(fixtureRoot) + path.sep));
	await fs.rm(resolved, { recursive: true, force: true });
}
