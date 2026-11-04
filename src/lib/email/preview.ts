export const MAX_TEXT_PREVIEW_BYTES = 256 * 1024;
export type PreviewKind = "audio" | "image" | "pdf" | "text" | "unsupported" | "video";

export function normalizeMimeType(type: string): string {
	return type.split(";", 1)[0].trim().toLowerCase();
}

export function previewKind(type: string): PreviewKind {
	type = normalizeMimeType(type);
	if (type === "application/pdf") return "pdf";
	if (
		["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/avif"].includes(type)
	)
		return "image";
	if (
		["audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm", "audio/flac"].includes(type)
	)
		return "audio";
	if (["video/mp4", "video/webm", "video/ogg", "video/quicktime"].includes(type)) return "video";
	if (
		[
			"text/plain",
			"text/csv",
			"application/json",
			"application/xml",
			"text/xml",
			"text/calendar",
		].includes(type)
	)
		return "text";
	return "unsupported";
}

/** Inspect bytes before allowing active browser decoders, including local files. */
export function detectPreviewType(bytes: Uint8Array, declared: string): string {
	const ascii = (offset: number, value: string) =>
		value.split("").every((char, index) => bytes[offset + index] === char.charCodeAt(0));
	if (ascii(0, "%PDF-")) return "application/pdf";
	if (bytes[0] === 137 && ascii(1, "PNG\r\n\x1a\n")) return "image/png";
	if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
	if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
	if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
	if (ascii(0, "BM")) return "image/bmp";
	if (ascii(4, "ftypavif") || ascii(4, "ftypavis")) return "image/avif";
	const type = normalizeMimeType(declared);
	if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "audio/wav";
	if (ascii(0, "fLaC")) return "audio/flac";
	if (ascii(0, "ID3") || (bytes[0] === 255 && ((bytes[1] ?? 0) & 224) === 224)) return "audio/mpeg";
	if (ascii(0, "OggS") && ["audio/ogg", "video/ogg"].includes(type)) return type;
	if (ascii(4, "ftyp") && ["audio/mp4", "video/mp4", "video/quicktime"].includes(type)) return type;
	if (
		bytes[0] === 26 &&
		bytes[1] === 69 &&
		bytes[2] === 223 &&
		bytes[3] === 163 &&
		["audio/webm", "video/webm"].includes(type)
	)
		return type;
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
		if (!bytes.includes(0)) {
			if (/^\s*BEGIN:VCALENDAR\s*(?:\r?\n|$)/i.test(text)) return "text/calendar";
			if (previewKind(type) === "text" && type !== "text/calendar") return type;
		}
	} catch {
		/* Invalid UTF-8 is a download-only file. */
	}
	return "application/octet-stream";
}

export function parseByteRange(
	value: string | null,
	size: number,
): { offset: number; length: number } | null | "invalid" {
	if (!value) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(value);
	if (!match || (!match[1] && !match[2]) || size === 0) return "invalid";
	const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
	const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		start >= size ||
		end < start ||
		(!match[1] && Number(match[2]) === 0)
	)
		return "invalid";
	return { offset: start, length: end - start + 1 };
}
