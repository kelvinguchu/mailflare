import type { AttachmentContent } from "./attachment-types";

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

export class IdempotencyConflictError extends Error {
	constructor() {
		super("The idempotency key was already used for a different email");
		this.name = "IdempotencyConflictError";
	}
}

export function normalizeIdempotencyKey(value: string | null | undefined): string {
	const key = value?.trim() || crypto.randomUUID();
	if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(key)) {
		throw new Error("Idempotency-Key must contain 1 to 200 printable ASCII characters");
	}
	return key;
}

export async function createStoredIdempotencyKey(userId: string, key: string): Promise<string> {
	return sha256(`${userId}\0${key}`);
}

export async function createScopedIdempotencyKey(
	scope: string,
	...parts: Array<string | number | null | undefined>
): Promise<string> {
	return `${scope}:${await sha256(JSON.stringify(parts))}`;
}

export async function createOutboundRequestHash(input: {
	from: string;
	to: string;
	subject: string;
	html?: string;
	text?: string;
	headers?: Record<string, string>;
	mailboxId: string;
	attachments: AttachmentContent[];
}): Promise<string> {
	const attachmentFingerprints = await Promise.all(input.attachments.map(async (attachment) => ({
		filename: attachment.filename,
		type: attachment.type,
		disposition: attachment.disposition ?? "attachment",
		contentId: attachment.contentId ?? null,
		contentHash: await sha256(attachment.content),
	})));
	const headers = Object.fromEntries(
		Object.entries(input.headers ?? {})
			.map(([name, value]) => [name.toLowerCase(), value] as const)
			.sort(([left], [right]) => left.localeCompare(right)),
	);

	return sha256(JSON.stringify({
		from: input.from,
		to: input.to,
		subject: input.subject,
		html: input.html ?? null,
		text: input.text ?? null,
		headers,
		mailboxId: input.mailboxId,
		attachments: attachmentFingerprints,
	}));
}

async function sha256(value: string | ArrayBuffer): Promise<string> {
	const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
