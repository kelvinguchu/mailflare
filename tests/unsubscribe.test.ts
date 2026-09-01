import { describe, expect, it } from "vitest";
import { extractUnsubscribeUrlFromRaw } from "../src/lib/email/unsubscribe";

function rawMessage(value: string): ArrayBuffer {
	return new TextEncoder().encode(value).buffer;
}

describe("List-Unsubscribe parsing", () => {
	it("prefers an HTTPS endpoint over mailto", () => {
		const raw = rawMessage([
			"From: sender@example.com",
			"List-Unsubscribe: <mailto:leave@example.com>, <https://example.com/unsubscribe/123>",
			"",
			"Message body",
		].join("\r\n"));

		expect(extractUnsubscribeUrlFromRaw(raw)).toBe("https://example.com/unsubscribe/123");
	});

	it("supports folded headers", () => {
		const raw = rawMessage([
			"List-Unsubscribe:",
			" <https://example.com/unsubscribe/folded>",
			"",
		].join("\r\n"));

		expect(extractUnsubscribeUrlFromRaw(raw)).toBe("https://example.com/unsubscribe/folded");
	});

	it("rejects non-web and non-mail protocols", () => {
		const raw = rawMessage("List-Unsubscribe: <javascript:alert(1)>\r\n\r\n");

		expect(extractUnsubscribeUrlFromRaw(raw)).toBeNull();
	});
});
