import { z } from "zod";

export const MESSAGE_CURSOR_MAX_LENGTH = 512;

export type MessageCursorKind = "messages" | "threads";

export type MessagePageCursor = {
	kind: MessageCursorKind;
	snapshotAt: Date;
	boundary: {
		createdAt: Date;
		id: string;
	};
};

const cursorSchema = z.object({
	v: z.literal(1),
	k: z.enum(["messages", "threads"]),
	s: z.number().int().nonnegative(),
	t: z.number().int().nonnegative(),
	i: z.string().min(1).max(200),
});

export class MessagePaginationValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MessagePaginationValidationError";
	}
}

export function encodeMessagePageCursor(cursor: MessagePageCursor): string {
	const json = JSON.stringify({
		v: 1,
		k: cursor.kind,
		s: cursor.snapshotAt.getTime(),
		t: cursor.boundary.createdAt.getTime(),
		i: cursor.boundary.id,
	});
	return btoa(json).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeMessagePageCursor(
	value: string,
	expectedKind: MessageCursorKind,
): MessagePageCursor {
	if (value.length > MESSAGE_CURSOR_MAX_LENGTH) {
		throw new MessagePaginationValidationError("The pagination cursor is too long");
	}

	try {
		const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
		const padding = "=".repeat((4 - (base64.length % 4)) % 4);
		const parsed = cursorSchema.parse(JSON.parse(atob(base64 + padding)));
		if (parsed.k !== expectedKind) {
			throw new MessagePaginationValidationError("The pagination cursor does not match this view");
		}
		const snapshotAt = new Date(parsed.s);
		const createdAt = new Date(parsed.t);
		if (
			!Number.isFinite(snapshotAt.getTime()) ||
			!Number.isFinite(createdAt.getTime()) ||
			createdAt > snapshotAt
		) {
			throw new MessagePaginationValidationError("The pagination cursor is invalid");
		}
		return {
			kind: parsed.k,
			snapshotAt,
			boundary: { createdAt, id: parsed.i },
		};
	} catch (error) {
		if (error instanceof MessagePaginationValidationError) throw error;
		throw new MessagePaginationValidationError("The pagination cursor is invalid");
	}
}
