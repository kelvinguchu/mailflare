import { describe, expect, it } from "vitest";
import { queueEmail } from "@/lib/email/send";

describe("outbound content validation", () => {
	it.each([
		{ text: undefined, html: undefined },
		{ text: " \n\t", html: "  " },
	])("rejects a message without a body before queueing it", async ({ text, html }) => {
		await expect(
			queueEmail({} as CloudflareEnv, {
				userId: "user_1",
				mailboxId: "mailbox_1",
				from: "me@example.com",
				to: "you@example.com",
				subject: "Test",
				text,
				html,
			}),
		).rejects.toThrow("Email body is required");
	});
});
