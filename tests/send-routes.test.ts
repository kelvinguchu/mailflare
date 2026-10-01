import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getCurrentUser: vi.fn(),
	queueEmail: vi.fn(),
	cancelScheduledOutboundJob: vi.fn(),
}));

vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/email/send", () => ({ queueEmail: mocks.queueEmail }));
vi.mock("@/lib/email/undo-send", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/email/undo-send")>();
	return { ...original, cancelScheduledOutboundJob: mocks.cancelScheduledOutboundJob };
});

import { POST as cancelSend } from "../src/app/api/send/[jobId]/cancel/route";
import { POST as sendMessage } from "../src/app/api/send/route";

describe("send route authentication", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getCurrentUser.mockResolvedValue(null);
	});

	it("returns 401 before parsing or queueing an unauthenticated send", async () => {
		const response = await sendMessage(
			new Request("https://mail.example/api/send", { method: "POST" }),
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Unauthorized" });
		expect(mocks.queueEmail).not.toHaveBeenCalled();
	});

	it("passes Cc through the authenticated send contract", async () => {
		mocks.getCurrentUser.mockResolvedValue({ id: "user_1" });
		mocks.queueEmail.mockResolvedValue({
			jobId: "job_1",
			messageId: "message_1",
			status: "queued",
			idempotencyKey: "send-1",
			undoDeadline: null,
		});
		const response = await sendMessage(
			new Request("https://mail.example/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json", "Idempotency-Key": "send-1" },
				body: JSON.stringify({
					from: "me@example.com",
					to: "one@example.com",
					cc: "two@example.com",
					subject: "Hello",
					text: "Body",
					mailboxId: "mailbox_1",
				}),
			}),
		);

		expect(response.status).toBe(202);
		expect(mocks.queueEmail).toHaveBeenCalledWith(
			{},
			expect.objectContaining({ userId: "user_1", cc: "two@example.com" }),
			expect.objectContaining({ idempotencyKey: "send-1" }),
		);
	});

	it("returns 400 when the outbound body is empty", async () => {
		mocks.getCurrentUser.mockResolvedValue({ id: "user_1" });
		mocks.queueEmail.mockRejectedValue(new Error("Email body is required"));
		const response = await sendMessage(
			new Request("https://mail.example/api/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					from: "me@example.com",
					to: "you@example.com",
					subject: "Test",
					text: "",
					mailboxId: "mailbox_1",
				}),
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Email body is required" });
	});

	it("returns 401 before looking up an unauthenticated cancellation", async () => {
		const response = await cancelSend(
			new Request("https://mail.example/api/send/job_1/cancel", { method: "POST" }),
			{ params: Promise.resolve({ jobId: "job_1" }) },
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Unauthorized" });
		expect(mocks.cancelScheduledOutboundJob).not.toHaveBeenCalled();
	});
});
