import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
	const migrations = await readD1Migrations(
		path.join(import.meta.dirname, "drizzle/migrations"),
	);

	return {
		resolve: {
			alias: { "@": path.join(import.meta.dirname, "src") },
		},
		plugins: [
			cloudflareTest({
				wrangler: { configPath: "./tests/integration/wrangler.jsonc" },
				miniflare: {
					bindings: { TEST_MIGRATIONS: migrations },
				},
			}),
		],
		test: {
			include: ["tests/integration/**/*.test.ts"],
			setupFiles: ["./tests/integration/setup.ts"],
		},
	};
});
