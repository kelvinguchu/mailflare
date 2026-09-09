import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function stripJsonComments(source) {
	let output = "";
	let inString = false;
	let escaped = false;
	let lineComment = false;
	let blockComment = false;

	for (let index = 0; index < source.length; index += 1) {
		const current = source[index];
		const next = source[index + 1];
		if (lineComment) {
			if (current === "\n") {
				lineComment = false;
				output += current;
			}
			continue;
		}
		if (blockComment) {
			if (current === "*" && next === "/") {
				blockComment = false;
				index += 1;
			} else if (current === "\n") {
				output += current;
			}
			continue;
		}
		if (inString) {
			output += current;
			if (escaped) escaped = false;
			else if (current === "\\") escaped = true;
			else if (current === '"') inString = false;
			continue;
		}
		if (current === '"') {
			inString = true;
			output += current;
		} else if (current === "/" && next === "/") {
			lineComment = true;
			index += 1;
		} else if (current === "/" && next === "*") {
			blockComment = true;
			index += 1;
		} else {
			output += current;
		}
	}
	return output;
}

function collectStatefulIdentifiers(environment) {
	const queueConsumers = environment.queues?.consumers ?? [];
	return new Set([
		environment.name,
		...(environment.d1_databases ?? []).flatMap((binding) => [binding.database_name, binding.database_id]),
		...(environment.r2_buckets ?? []).map((binding) => binding.bucket_name),
		...(environment.queues?.producers ?? []).map((binding) => binding.queue),
		...queueConsumers.flatMap((binding) => [binding.queue, binding.dead_letter_queue]),
		...(environment.workflows ?? []).map((binding) => binding.name),
		...(environment.services ?? []).map((binding) => binding.service),
		...(environment.ratelimits ?? []).map((binding) => binding.namespace_id),
	].filter(Boolean));
}

function collectNamedResources(environment) {
	return [
		environment.name,
		...(environment.d1_databases ?? []).map((binding) => binding.database_name),
		...(environment.r2_buckets ?? []).map((binding) => binding.bucket_name),
		...(environment.queues?.producers ?? []).map((binding) => binding.queue),
		...(environment.queues?.consumers ?? []).flatMap((binding) => [binding.queue, binding.dead_letter_queue]),
		...(environment.workflows ?? []).map((binding) => binding.name),
		...(environment.services ?? []).map((binding) => binding.service),
	].filter(Boolean);
}

export function checkEnvironmentIsolation(configPath = new URL("../wrangler.jsonc", import.meta.url)) {
	const config = JSON.parse(stripJsonComments(readFileSync(configPath, "utf8")));
	const staging = config.env?.staging;
	const production = config.env?.production;
	if (!staging || !production) throw new Error("Both staging and production environments are required");

	const productionIdentifiers = collectStatefulIdentifiers(production);
	const reused = [...collectStatefulIdentifiers(staging)].filter((value) => productionIdentifiers.has(value));
	if (reused.length > 0) throw new Error(`Staging reuses production identifiers: ${reused.join(", ")}`);
	const incorrectlyNamed = collectNamedResources(staging).filter((value) => !value.endsWith("-staging"));
	if (incorrectlyNamed.length > 0) throw new Error(`Staging resources must end in -staging: ${incorrectlyNamed.join(", ")}`);
	if ((staging.send_email ?? []).length > 0) throw new Error("Staging must not have an Email Sending binding");
	if ((staging.triggers?.crons ?? []).length > 0) throw new Error("Staging cron schedules must remain disabled");
	if (staging.vars?.OUTBOUND_DELIVERY_MODE !== "disabled") throw new Error("Staging outbound delivery must be disabled");
	if (staging.vars?.CLOUDFLARE_MANAGEMENT_MODE !== "disabled") throw new Error("Staging Cloudflare management must be disabled");
	if (staging.routes || staging.route) throw new Error("Staging must not use production or custom routes");
	if (staging.workers_dev !== true) throw new Error("Staging must use its workers.dev URL");
	if ((staging.durable_objects?.bindings ?? []).some((binding) => binding.script_name)) {
		throw new Error("Staging Durable Objects must be owned by the staging Worker");
	}
	return { staging, production };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	checkEnvironmentIsolation();
	console.log("Staging and production resource identifiers are isolated.");
}
