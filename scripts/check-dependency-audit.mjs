import { spawnSync } from "node:child_process";

function audit(args) {
  const result = spawnSync("npm", ["audit", "--json", ...args], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  try {
    return JSON.parse(result.stdout);
  } catch {
    process.stderr.write(result.stderr || result.stdout);
    throw new Error("npm audit did not return valid JSON");
  }
}

const production = audit(["--omit=dev"]);
if (production.metadata?.vulnerabilities?.total !== 0) {
  console.error("Production dependency audit failed.");
  console.error(JSON.stringify(production.vulnerabilities, null, 2));
  process.exit(1);
}

const complete = audit([]);
if (complete.metadata?.vulnerabilities?.total !== 0) {
	console.error("Development dependency audit failed.");
	console.error(JSON.stringify(complete.vulnerabilities, null, 2));
	process.exit(1);
}

console.log("Dependency audit passed: production and development dependencies have no known findings.");
