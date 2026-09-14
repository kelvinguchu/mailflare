import { describe, expect, it } from "vitest";
import { parseRawMime } from "../src/lib/email/parse";
import {
	createOutboundProviderMessageId,
	normalizeProviderMessageId,
	normalizeThreadSubject,
	parseMessageReferences,
} from "../src/lib/email/threading";

describe("conversation threading headers", () => {
	it("normalizes Message-IDs and caps references from the newest end", () => {
		expect(normalizeProviderMessageId("parent@example.net")).toBe("<parent@example.net>");
		expect(normalizeProviderMessageId(" <parent@example.net> ")).toBe("<parent@example.net>");
		const references = Array.from(
			{ length: 22 },
			(_, index) => `message-${index}@example.net`,
		).join(" ");
		expect(parseMessageReferences(references)).toHaveLength(20);
		expect(parseMessageReferences(references)[0]).toBe("<message-2@example.net>");
	});

	it("parses folded reply headers and missing angle brackets", async () => {
		const raw = new TextEncoder().encode(
			[
				"From: Maya <maya@example.net>",
				"To: Support <support@example.test>",
				"Subject: Re: Status",
				"Message-ID: child@example.net",
				"In-Reply-To: parent@example.net",
				"References: root@example.net",
				" parent@example.net",
				"",
				"Hello",
			].join("\r\n"),
		).buffer;
		const parsed = await parseRawMime(raw);
		expect(parsed.messageId).toBe("<child@example.net>");
		expect(parsed.inReplyTo).toBe("<parent@example.net>");
		expect(parsed.references).toEqual(["<root@example.net>", "<parent@example.net>"]);
	});

	it("normalizes repeated localized reply and forward prefixes", () => {
		expect(normalizeThreadSubject(" RE: Fwd: AW:  Quarterly   Status ")).toBe("quarterly status");
		expect(normalizeThreadSubject("Fw: SV: Update")).toBe("update");
		expect(normalizeThreadSubject("Re:   ")).toBe("");
	});

	it("generates a stable outbound identifier from the sender domain", () => {
		expect(createOutboundProviderMessageId("msg_123", "Support <support@Example.TEST>")).toBe(
			"<msg_123@example.test>",
		);
	});
});
