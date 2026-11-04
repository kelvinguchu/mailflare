import type { SessionUser } from "@/lib/auth/types";
import { getAuthorizedAttachment } from "./attachments";
import { detectPreviewType, parseByteRange, previewKind } from "./preview";
export async function serveAuthorizedAttachment(
	env: CloudflareEnv,
	user: SessionUser,
	request: Request,
	messageId: string,
	attachmentId: string,
	head = false,
) {
	const attachment = await getAuthorizedAttachment(env, user, messageId, attachmentId);
	if (!attachment) return new Response("Not found", { status: 404 });
	return serveStoredAttachment(env, request, attachment, head);
}

export async function serveStoredAttachment(
	env: CloudflareEnv,
	request: Request,
	attachment: { r2Key: string; contentType: string; filename: string; disposition: string },
	head = false,
) {
	const metadata = await env.BUCKET.head(attachment.r2Key);
	if (!metadata) return new Response("Not found", { status: 404 });
	const sample = metadata.size
		? await env.BUCKET.get(attachment.r2Key, {
				range: { offset: 0, length: Math.min(512, metadata.size) },
			})
		: null;
	const type = detectPreviewType(
		sample ? new Uint8Array(await sample.arrayBuffer()) : new Uint8Array(),
		attachment.contentType,
	);
	const url = new URL(request.url);
	const previewRequested = url.searchParams.get("preview") === "1";
	const downloadRequested = url.searchParams.get("download") === "1";
	const inline =
		!downloadRequested &&
		isPreviewableAttachmentType(type) &&
		(attachment.disposition === "inline" || previewRequested);
	const headers = new Headers();
	headers.set("Content-Type", inline ? type : attachment.contentType);
	headers.set("Content-Length", String(metadata.size));
	headers.set("Content-Disposition", getAttachmentContentDisposition(attachment.filename, inline));
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set(
		"Content-Security-Policy",
		"default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
	);
	headers.set("Cache-Control", "private, no-store");
	headers.set("Accept-Ranges", "bytes");
	headers.set("X-Preview-Type", type);
	const range = parseByteRange(request.headers.get("Range"), metadata.size);
	if (range === "invalid") {
		headers.set("Content-Range", `bytes */${metadata.size}`);
		headers.set("Content-Length", "0");
		return new Response(null, { status: 416, headers });
	}
	if (range) {
		headers.set(
			"Content-Range",
			`bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`,
		);
		headers.set("Content-Length", String(range.length));
	}
	if (head) return new Response(null, { status: range ? 206 : 200, headers });
	const object = await env.BUCKET.get(attachment.r2Key, {
		...(range ? { range } : {}),
		onlyIf: { etagMatches: metadata.etag },
	});
	if (!object || !("body" in object)) return new Response("Not found", { status: 404 });
	return new Response(object.body, { status: range ? 206 : 200, headers });
}

export function getAttachmentContentDisposition(filename: string, inline: boolean): string {
	const normalized = filename.replace(/["\\\x00-\x1f\x7f]/g, "_");
	const safeFilename = normalized.replace(/[^\x20-\x7e]/g, "_");
	const encoded = encodeURIComponent(normalized).replace(
		/['()*]/g,
		(value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return `${inline ? "inline" : "attachment"}; filename="${safeFilename}"; filename*=UTF-8''${encoded}`;
}

export function isPreviewableAttachmentType(contentType: string): boolean {
	return previewKind(contentType) !== "unsupported";
}
