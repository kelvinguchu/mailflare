import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [action, environment] = process.argv.slice(2);
if (!["deploy", "upload"].includes(action) || !["staging", "production"].includes(environment)) {
	console.error("Usage: node scripts/run-wrangler.mjs <deploy|upload> <staging|production>");
	process.exit(2);
}

const wranglerPath = fileURLToPath(
	new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
const wranglerArgs = action === "deploy" ? ["deploy"] : ["versions", "upload"];
const result = spawnSync(
	process.execPath,
	[wranglerPath, ...wranglerArgs, "--env", environment],
	{
		stdio: "inherit",
		env: { ...process.env, OPEN_NEXT_DEPLOY: "true" },
	},
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
