import { describe, expect, it } from "vitest";
import { formatEmailPageTitle, getMailboxAddress } from "@/components/messages/utils";

describe("message page title", () => {
	it("uses the canonical sender address when legacy mailbox data has no hostname", () => {
		const address = getMailboxAddress({
			localPart: "billing",
			hostname: undefined,
			senderAddresses: ["billing@example.com"],
		});

		expect(address).toBe("billing@example.com");
		expect(formatEmailPageTitle({ location: "Inbox", unread: 1, emailAddress: address })).toBe(
			"Inbox (1) - billing@example.com",
		);
	});

	it("omits the address rather than rendering undefined when no valid address exists", () => {
		const address = getMailboxAddress({
			localPart: "billing",
			hostname: undefined,
			senderAddresses: [],
		});

		expect(address).toBeNull();
		expect(formatEmailPageTitle({ location: "Inbox", unread: 1, emailAddress: address })).toBe(
			"Inbox (1)",
		);
	});

	it("does not substitute the total message count when there are no unread messages", () => {
		expect(
			formatEmailPageTitle({
				location: "Inbox",
				unread: 0,
				emailAddress: "billing@example.com",
			}),
		).toBe("Inbox - billing@example.com");
	});
});
