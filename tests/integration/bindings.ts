import { env } from "cloudflare:workers";
import type { D1Migration } from "@cloudflare/vitest-plugin";

export type IntegrationEnv = CloudflareEnv & {
	MIGRATION_DB: D1Database;
	SETUP_DB: D1Database;
	TEST_MIGRATIONS: D1Migration[];
};

export const integrationEnv = env as unknown as IntegrationEnv;
