import { describe, expect, it } from "vitest";
import {
	buildFtsPhrase,
	buildScopedFtsPhrase,
	MESSAGE_SEARCH_LIMITS,
	MessageSearchValidationError,
	parseMessageSearchParams,
} from "../src/lib/messages/search";

describe("message search", () => {
	it("quotes all user input as an FTS phrase", () => {
		expect(buildFtsPhrase('invoice" OR secret')).toBe('"invoice"" OR secret"');
		expect(buildScopedFtsPhrase("sender", "billing@example.com")).toBe(
			'sender : "billing@example.com"',
		);
	});

	it("parses bounded search and filter parameters", () => {
		const result = parseMessageSearchParams(
			new URLSearchParams({
				q: " invoice ",
				from: "billing@example.com",
				to: "finance@example.com",
				hasAttachments: "true",
				after: "2026-01-01",
				before: "2026-12-31",
				limit: "25",
				offset: "10",
			}),
		);

		expect(result).toMatchObject({
			query: "invoice",
			sender: "billing@example.com",
			recipient: "finance@example.com",
			hasAttachments: true,
			limit: 25,
			offset: 10,
		});
		expect(result.after?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
		expect(result.before?.toISOString()).toBe("2026-12-31T23:59:59.999Z");
	});

	it.each([
		[new URLSearchParams({ q: "ab" }), "at least 3"],
		[new URLSearchParams({ limit: "0" }), ">=1"],
		[new URLSearchParams({ limit: String(MESSAGE_SEARCH_LIMITS.resultLimit + 1) }), "<=100"],
		[new URLSearchParams({ offset: "1.5" }), "whole number"],
		[new URLSearchParams({ hasAttachments: "yes" }), "Invalid option"],
		[new URLSearchParams({ after: "2026-02-01", before: "2026-01-01" }), "must not be later"],
	])("rejects malformed parameters", (params, expectedMessage) => {
		expect(() => parseMessageSearchParams(params)).toThrow(expectedMessage);
	});

	it("rejects duplicate controlled parameters", () => {
		const params = new URLSearchParams();
		params.append("q", "invoice");
		params.append("q", "secret");

		expect(() => parseMessageSearchParams(params)).toThrow(MessageSearchValidationError);
	});
});
