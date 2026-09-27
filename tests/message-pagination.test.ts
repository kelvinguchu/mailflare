import { describe, expect, it } from "vitest";
import {
	decodeMessagePageCursor,
	encodeMessagePageCursor,
	MessagePaginationValidationError,
} from "../src/lib/messages/pagination";

describe("message pagination cursors", () => {
	it("round-trips a stable page boundary", () => {
		const cursor = encodeMessagePageCursor({
			kind: "messages",
			snapshotAt: new Date("2026-09-14T10:00:00.000Z"),
			boundary: {
				createdAt: new Date("2026-09-14T09:59:00.000Z"),
				id: "msg_123",
			},
		});

		expect(decodeMessagePageCursor(cursor, "messages")).toEqual({
			kind: "messages",
			snapshotAt: new Date("2026-09-14T10:00:00.000Z"),
			boundary: {
				createdAt: new Date("2026-09-14T09:59:00.000Z"),
				id: "msg_123",
			},
		});
	});

	it("rejects malformed cursors and cursors from another view", () => {
		expect(() => decodeMessagePageCursor("not-base64", "messages")).toThrow(
			MessagePaginationValidationError,
		);
		const threadCursor = encodeMessagePageCursor({
			kind: "threads",
			snapshotAt: new Date("2026-09-14T10:00:00.000Z"),
			boundary: { createdAt: new Date("2026-09-14T09:59:00.000Z"), id: "thread_1" },
		});
		expect(() => decodeMessagePageCursor(threadCursor, "messages")).toThrow(
			"does not match this view",
		);
	});
});
