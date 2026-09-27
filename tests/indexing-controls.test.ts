import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import robots from "../src/app/robots";
import { getSecurityHeaders } from "../src/lib/security/headers";
import { APP_ROBOTS_METADATA, ROBOTS_DIRECTIVE } from "../src/lib/security/indexing";

describe("internal application indexing controls", () => {
	it("asks crawlers not to index or follow any page", () => {
		expect(APP_ROBOTS_METADATA).toMatchObject({
			index: false,
			follow: false,
			googleBot: { index: false, follow: false },
		});
		expect(ROBOTS_DIRECTIVE).toBe("noindex, nofollow");
	});

	it("disallows crawling the whole application in robots.txt", () => {
		expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
	});

	it("sends X-Robots-Tag with every response in both environments", () => {
		for (const environment of ["development", "production"] as const) {
			expect(getSecurityHeaders(environment)).toContainEqual({
				key: "X-Robots-Tag",
				value: "noindex, nofollow",
			});
		}
	});

	it("applies the robots metadata from the root layout", () => {
		const layout = readFileSync(path.join(import.meta.dirname, "../src/app/layout.tsx"), "utf8");
		expect(layout).toMatch(/robots:\s*APP_ROBOTS_METADATA/);
	});
});
