import { describe, expect, it } from "vitest";
import { formatPostalAddressList } from "../src/lib/email/address";
import {
	MAX_EMAIL_RECIPIENTS,
	normalizeRecipients,
	parseRecipientList,
} from "../src/lib/email/recipients";
import { parseRawMime } from "../src/lib/email/parse";

describe("email recipients", () => {
	it("normalizes display names and removes duplicates across To and Cc with To winning", () => {
		const recipients = normalizeRecipients({
			to: '"Maya Chen" <MAYA@example.com>, ops@example.com',
			cc: "maya@example.com; Finance <finance@example.com>; OPS@example.com",
		});

		expect(recipients.toHeader).toBe('"Maya Chen" <maya@example.com>, ops@example.com');
		expect(recipients.ccHeader).toBe('"Finance" <finance@example.com>');
		expect(recipients.to.map((item) => item.address)).toEqual([
			"maya@example.com",
			"ops@example.com",
		]);
	});

	it("rejects invalid recipients and a combined set larger than the provider limit", () => {
		expect(() => normalizeRecipients({ to: "not-an-address" })).toThrow("invalid email address");
		const addresses = Array.from(
			{ length: MAX_EMAIL_RECIPIENTS + 1 },
			(_, index) => `person-${index}@example.com`,
		).join(", ");
		expect(() => normalizeRecipients({ to: addresses })).toThrow("at most 50");
	});

	it("flattens every mailbox from MIME address groups", () => {
		expect(
			formatPostalAddressList(
				[
					{
						name: "Team",
						group: [
							{ name: "Maya", address: "maya@example.com" },
							{ name: "", address: "ops@example.com" },
						],
					},
				],
				null,
			),
		).toBe('"Maya" <maya@example.com>, ops@example.com');
	});

	it("parses distinct MIME To and Cc headers", async () => {
		const raw = new TextEncoder().encode(
			"From: sender@example.net\r\n" +
				"To: one@example.com, Two <two@example.com>\r\n" +
				"Cc: three@example.com\r\n" +
				"Subject: Recipients\r\n\r\nHello",
		).buffer;
		const parsed = await parseRawMime(raw);

		expect(parseRecipientList(parsed.toAddr).map((item) => item.address)).toEqual([
			"one@example.com",
			"two@example.com",
		]);
		expect(parsed.ccAddr).toBe("three@example.com");
	});
});
