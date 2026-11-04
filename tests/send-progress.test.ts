/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposeSnapshot } from "@/components/compose/types";

const mocks = vi.hoisted(() => ({
	lookup: vi.fn(),
	upload: vi.fn(),
	save: vi.fn(),
	remove: vi.fn(),
	add: vi.fn(() => "toast-1"),
	update: vi.fn(),
	close: vi.fn(),
}));
vi.mock("@/components/ui/toast", () => ({
	toast: { add: mocks.add, update: mocks.update, close: mocks.close },
}));
vi.mock("@/components/compose/send-transport", () => ({
	lookupSend: mocks.lookup,
	uploadSend: mocks.upload,
}));
vi.mock("@/components/compose/send-recovery", () => ({
	saveSendRecovery: mocks.save,
	removeSendRecovery: mocks.remove,
}));
import { sendWithUndo } from "@/components/compose/send-with-undo";

const snapshot: ComposeSnapshot = {
	to: "recipient@example.test",
	cc: "",
	subject: "Hello",
	text: "Attached",
	attachments: [],
	mailboxId: "mailbox",
	selectedFrom: "sender@example.test",
	from: "sender@example.test",
	undoDelaySeconds: "0",
	sendKey: "same-send-key",
};
const restore = vi.fn();
async function flush() {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	mocks.save.mockResolvedValue(undefined);
	mocks.remove.mockResolvedValue(undefined);
	mocks.lookup.mockResolvedValue({ found: false, data: {} });
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("send progress and uncertain-outcome recovery", () => {
	it("keeps recovery files while queued and only clears them after provider acceptance", async () => {
		mocks.upload.mockResolvedValue({ ok: true, data: { status: "queued", jobId: "job-1" } });
		mocks.lookup
			.mockResolvedValueOnce({ found: false, data: {} })
			.mockResolvedValueOnce({ found: true, data: { status: "sending" } })
			.mockResolvedValueOnce({ found: true, data: { status: "sent", deliveryStatus: "accepted" } });
		sendWithUndo({ snapshot, draftId: Promise.resolve(null), restore });
		await flush();
		expect(mocks.remove).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(3000);
		expect(mocks.update).toHaveBeenLastCalledWith(
			"toast-1",
			expect.objectContaining({ title: "Sending…" }),
		);
		await vi.advanceTimersByTimeAsync(3000);
		expect(mocks.remove).toHaveBeenCalledWith(snapshot.sendKey);
		expect(mocks.update).toHaveBeenLastCalledWith(
			"toast-1",
			expect.objectContaining({ title: "Provider accepted" }),
		);
		expect(mocks.upload).toHaveBeenCalledTimes(1);
	});
	it("stops polling an unknown queued outcome without offering a resend", async () => {
		mocks.upload.mockResolvedValue({ ok: true, data: { status: "queued", jobId: "job-1" } });
		mocks.lookup
			.mockResolvedValueOnce({ found: false, data: {} })
			.mockResolvedValue({ found: true, data: { status: "failed", deliveryStatus: "unknown" } });
		sendWithUndo({ snapshot, draftId: Promise.resolve(null), restore });
		await flush();
		await vi.advanceTimersByTimeAsync(3000);
		expect(mocks.update).toHaveBeenLastCalledWith(
			"toast-1",
			expect.objectContaining({ title: "Send outcome unknown", actionProps: undefined }),
		);
		await vi.advanceTimersByTimeAsync(150_000);
		expect(mocks.lookup).toHaveBeenCalledTimes(2);
		expect(mocks.upload).toHaveBeenCalledTimes(1);
		expect(mocks.remove).not.toHaveBeenCalled();
	});
	it("shows actual transfer progress and labels queue acceptance accurately", async () => {
		mocks.upload.mockImplementation(async (_snapshot, progress) => {
			progress(25);
			progress(100);
			return { ok: true, data: { status: "queued", jobId: "job-1" } };
		});
		sendWithUndo({ snapshot, draftId: Promise.resolve(null), restore });
		await flush();
		expect(mocks.update.mock.calls.map(([, options]) => options.title)).toEqual(
			expect.arrayContaining(["Uploading 25%", "Preparing message…", "Message queued"]),
		);
		expect(mocks.update.mock.calls.some(([, options]) => options.title === "Message sent")).toBe(
			false,
		);
		expect(mocks.save).toHaveBeenCalledWith(snapshot);
	});
	it("looks up a timed-out upload with the original key without submitting twice", async () => {
		mocks.upload.mockRejectedValue(new Error("timeout"));
		mocks.lookup.mockResolvedValueOnce({ found: false, data: {} }).mockResolvedValueOnce({
			found: true,
			data: { status: "sent", jobId: "job-1", deliveryStatus: "accepted" },
		});
		sendWithUndo({ snapshot, draftId: Promise.resolve(null), restore });
		await flush();
		expect(mocks.upload).toHaveBeenCalledTimes(1);
		expect(mocks.lookup).toHaveBeenNthCalledWith(2, snapshot.sendKey);
		expect(mocks.update).toHaveBeenLastCalledWith(
			"toast-1",
			expect.objectContaining({ title: "Provider accepted" }),
		);
	});
	it("does not retry or offer an edit/resend action for an unknown provider outcome", async () => {
		mocks.lookup.mockResolvedValue({
			found: true,
			data: { status: "failed", deliveryStatus: "unknown", error: "E_DELIVERY_OUTCOME_UNKNOWN" },
		});
		sendWithUndo({ snapshot, draftId: Promise.resolve(null), restore });
		await flush();
		expect(mocks.upload).not.toHaveBeenCalled();
		expect(restore).not.toHaveBeenCalled();
		expect(mocks.remove).not.toHaveBeenCalled();
		expect(mocks.update).toHaveBeenLastCalledWith(
			"toast-1",
			expect.objectContaining({ title: "Send outcome unknown", actionProps: undefined }),
		);
	});
	it("preserves all fields/files on a recoverable rejection and never claims send success", async () => {
		const withFile = {
			...snapshot,
			attachments: [{ id: "file-1", file: new File(["PDF data"], "report.pdf") }],
		};
		mocks.upload.mockResolvedValue({
			ok: false,
			data: { error: "Remove files", code: "E_CONTENT_TOO_LARGE" },
		});
		sendWithUndo({ snapshot: withFile, draftId: Promise.resolve("draft-1"), restore });
		await flush();
		const options = mocks.update.mock.calls.at(-1)![1];
		expect(options.title).toBe("Message not sent");
		options.actionProps.onClick();
		await flush();
		expect(restore).toHaveBeenCalledWith({ ...withFile, draftId: "draft-1" });
		expect(mocks.remove).not.toHaveBeenCalled();
	});
});
