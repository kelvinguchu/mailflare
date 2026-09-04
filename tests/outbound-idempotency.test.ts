import { describe, expect, it } from "vitest";
import {
	createOutboundRequestHash,
	createScopedIdempotencyKey,
	createStoredIdempotencyKey,
	normalizeIdempotencyKey,
} from "../src/lib/email/outbound-idempotency";
import { claimOutboundDelivery } from "../src/lib/email/outbound-claim";

function request(overrides?: Partial<Parameters<typeof createOutboundRequestHash>[0]>) {
	return {
		from: "CaliberCode <info@calibercode.io>",
		to: "person@example.com",
		subject: "Hello",
		text: "Message body",
		mailboxId: "mailbox_1",
		attachments: [{
			filename: "report.txt",
			type: "text/plain",
			content: new TextEncoder().encode("report").buffer,
			disposition: "attachment" as const,
		}],
		...overrides,
	};
}

describe("outbound request idempotency", () => {
	it("keeps the same logical request hash stable", async () => {
		const first = await createOutboundRequestHash(request({
			headers: { References: "<message@example.com>", "X-Trace": "abc" },
		}));
		const replay = await createOutboundRequestHash(request({
			headers: { "x-trace": "abc", references: "<message@example.com>" },
		}));
		expect(replay).toBe(first);
	});

	it("detects reuse of a key with changed content or attachments", async () => {
		const original = await createOutboundRequestHash(request());
		const changedBody = await createOutboundRequestHash(request({ text: "Different body" }));
		const changedAttachment = await createOutboundRequestHash(request({
			attachments: [{
				filename: "report.txt",
				type: "text/plain",
				content: new TextEncoder().encode("changed").buffer,
				disposition: "attachment",
			}],
		}));
		expect(changedBody).not.toBe(original);
		expect(changedAttachment).not.toBe(original);
	});

	it("scopes stored request keys to the authenticated account", async () => {
		const first = await createStoredIdempotencyKey("user_1", "request_1");
		const replay = await createStoredIdempotencyKey("user_1", "request_1");
		const otherUser = await createStoredIdempotencyKey("user_2", "request_1");
		expect(replay).toBe(first);
		expect(otherUser).not.toBe(first);
		expect(first).toMatch(/^[a-f0-9]{64}$/);
	});

	it("derives stable keys for calendar invitations and auto-replies", async () => {
		const first = await createScopedIdempotencyKey("auto-reply", "mailbox_1", "msg_1");
		const replay = await createScopedIdempotencyKey("auto-reply", "mailbox_1", "msg_1");
		const otherMessage = await createScopedIdempotencyKey("auto-reply", "mailbox_1", "msg_2");
		expect(replay).toBe(first);
		expect(otherMessage).not.toBe(first);
	});

	it("validates client keys and generates one when omitted", () => {
		expect(normalizeIdempotencyKey(" request-123 ")).toBe("request-123");
		expect(normalizeIdempotencyKey(null)).toMatch(/^[0-9a-f-]{36}$/i);
		expect(() => normalizeIdempotencyKey("bad key")).toThrow(/printable ASCII/);
		expect(() => normalizeIdempotencyKey("x".repeat(201))).toThrow(/1 to 200/);
	});

	it("allows only one duplicate queue delivery to claim the provider send", async () => {
		let state = { status: "queued", deliveryStartedAt: null as number | null, attemptCount: 0 };
		const db = {
			prepare: () => ({
				bind: () => ({
					run: async () => {
						if (state.status !== "queued" || state.deliveryStartedAt !== null) {
							return { meta: { changes: 0 } } as D1Result;
						}
						state = { status: "sending", deliveryStartedAt: 1, attemptCount: 1 };
						return { meta: { changes: 1 } } as D1Result;
					},
				}),
			}),
		} as unknown as Pick<D1Database, "prepare">;

		await expect(claimOutboundDelivery(db, "job_1")).resolves.toBe(true);
		await expect(claimOutboundDelivery(db, "job_1")).resolves.toBe(false);
		expect(state).toEqual({ status: "sending", deliveryStartedAt: 1, attemptCount: 1 });
	});
});
