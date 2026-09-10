import { describe, expect, it } from "vitest";
import { summariseDns } from "../src/lib/dns-status";

describe("domain health", () => {
	it("reports routing, sending, SPF, DKIM and DMARC independently", () => {
		const summary = summariseDns(
			[{ type: "MX", name: "example.test", content: "route.mx.cloudflare.net" }],
			[],
			[{ type: "TXT", name: "send.example.test", content: "v=spf1 include:_spf.mx.cloudflare.net ~all" }, { type: "TXT", name: "selector._domainkey.example.test", content: "v=DKIM1; p=abc" }],
			[{ type: "TXT", name: "_dmarc.example.test", content: "v=DMARC1; p=none" }],
			"example.test",
		);
		expect(summary.routing.configured).toBe(true);
		expect(summary.sending.configured).toBe(true);
		expect(summary.authentication).toEqual({ spf: true, dkim: true, dmarc: true });
		expect(summary.warnings).toEqual([]);
	});

	it("returns actionable warnings for missing authentication", () => {
		const summary = summariseDns([], [{ type: "MX" }], [], [], "example.test");
		expect(summary.warnings).toHaveLength(5);
		expect(summary.authentication.dmarc).toBe(false);
	});
});
