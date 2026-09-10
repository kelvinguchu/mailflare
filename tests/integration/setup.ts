import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-plugin";

type IntegrationEnv = CloudflareEnv & {
	MIGRATION_DB: D1Database;
	SETUP_DB: D1Database;
	TEST_MIGRATIONS: D1Migration[];
};

await applyD1Migrations(
	(env as unknown as IntegrationEnv).DB,
	(env as unknown as IntegrationEnv).TEST_MIGRATIONS,
);
