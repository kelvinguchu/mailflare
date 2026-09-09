import { describe, expect, it } from "vitest";
import { isCloudflareManagementEnabled } from "../src/lib/cloudflare-api-utils";
import { checkEnvironmentIsolation } from "../scripts/check-environment-isolation.mjs";

describe("deployment environment safety", () => {
	it("fails closed unless Cloudflare management is explicitly enabled", () => {
		expect(isCloudflareManagementEnabled("enabled")).toBe(true);
		expect(isCloudflareManagementEnabled("disabled")).toBe(false);
		expect(isCloudflareManagementEnabled(undefined)).toBe(false);
	});

	it("does not reuse production stateful resources or enable staging delivery", () => {
		expect(() => checkEnvironmentIsolation()).not.toThrow();
	});
});
