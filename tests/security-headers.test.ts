import { describe, expect, it } from "vitest";
import { getSecurityHeaders } from "../src/lib/security/headers";

function getContentSecurityPolicy(environment: "development" | "production"): string {
	return getSecurityHeaders(environment).find(
		(header) => header.key === "Content-Security-Policy",
	)?.value ?? "";
}

describe("security headers", () => {
	it("does not permit eval or inline script attributes in production", () => {
		const policy = getContentSecurityPolicy("production");

		expect(policy).not.toContain("'unsafe-eval'");
		expect(policy).toContain("script-src-attr 'none'");
	});

	it("permits eval only for the development toolchain", () => {
		const policy = getContentSecurityPolicy("development");

		expect(policy).toContain("'unsafe-eval'");
		expect(policy).toContain("script-src-attr 'none'");
	});
});
