import { describe, expect, it } from "vitest";
import { integrationEnv } from "./bindings";

describe("Workers integration harness", () => {
	it("applies the complete schema to isolated D1 and provides isolated R2", async () => {
		const tables = await integrationEnv.DB
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all<{ name: string }>();
		expect(tables.results.map((table) => table.name)).toContain("messages");

		await integrationEnv.BUCKET.put("harness/probe.txt", "ready");
		expect(await (await integrationEnv.BUCKET.get("harness/probe.txt"))?.text()).toBe("ready");
	});
});
