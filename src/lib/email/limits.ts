/** Cloudflare general-recipient limit, including MIME/base64 overhead (7 Oct 2026).
 * https://developers.cloudflare.com/email-service/platform/limits/
 * No assumption is made that every recipient is a verified destination.
 */
export const MAX_MESSAGE_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_COUNT = 10;
export const MAX_ATTACHMENT_SIZE = 3 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_SIZE = 3 * 1024 * 1024;
export const MAX_SEND_REQUEST_SIZE = 8 * 1024 * 1024;

export class SendLimitError extends Error {
	constructor(
		message: string,
		readonly code: "E_CONTENT_TOO_LARGE" | "E_TOO_MANY_ATTACHMENTS",
		readonly status = 413,
	) {
		super(message);
	}
}

type SizedFile = { filename?: string; size: number };
export function attachmentLimitError(files: SizedFile[]): string | null {
	if (files.length > MAX_ATTACHMENT_COUNT)
		return `A message can include at most ${MAX_ATTACHMENT_COUNT} attachments`;
	if (files.some((file) => file.size > MAX_ATTACHMENT_SIZE))
		return "Each attachment must be 3 MiB or smaller";
	if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_ATTACHMENT_SIZE)
		return "Attachments must total 3 MiB or less";
	return null;
}

/** Conservative upper budget: base64 line breaks, worst-case quoted-printable
 * bodies/headers, MIME boundaries and provider headers. Signature assets count.
 */
export function estimatedMessageBytes(
	input: {
		text?: string | null;
		html?: string | null;
		subject?: string | null;
		from?: string;
		to?: string;
		cc?: string;
		headers?: Record<string, string>;
	},
	files: SizedFile[],
): number {
	const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
	const fields = [
		input.text ?? "",
		input.html ?? "",
		input.subject ?? "",
		input.from ?? "",
		input.to ?? "",
		input.cc ?? "",
		...Object.entries(input.headers ?? {}).map(([key, value]) => `${key}: ${value}`),
	];
	return (
		64 * 1024 +
		fields.reduce((sum, field) => sum + 3 * bytes(field), 0) +
		files.reduce((sum, file) => {
			const encoded = 4 * Math.ceil(file.size / 3);
			return sum + encoded + 2 * Math.ceil(encoded / 76) + 4096 + 3 * bytes(file.filename ?? "");
		}, 0)
	);
}

export function validateMessageBudget(
	input: Parameters<typeof estimatedMessageBytes>[0],
	files: SizedFile[],
): void {
	if (estimatedMessageBytes(input, files) > MAX_MESSAGE_BYTES)
		throw new SendLimitError(
			"Message exceeds the 5 MiB email limit, including body, signature and encoded attachments. Remove files or shorten the message.",
			"E_CONTENT_TOO_LARGE",
		);
}
