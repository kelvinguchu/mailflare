import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { signatureAssets } from "@/db/schema";
import { newId } from "@/lib/ids";
import type { SignatureAssetMetadata, SignatureImageDimensions } from "./signature-asset-types";

export const MAX_SIGNATURE_ASSET_COUNT = 5;
export const MAX_SIGNATURE_ASSET_SIZE = 512 * 1024;
export const MAX_SIGNATURE_ASSETS_TOTAL_SIZE = 2 * 1024 * 1024;
export const MAX_SIGNATURE_IMAGE_WIDTH = 1_200;
export const MAX_SIGNATURE_IMAGE_HEIGHT = 600;
export const ALLOWED_SIGNATURE_IMAGE_TYPES = ["image/gif", "image/jpeg", "image/png"] as const;

type AllowedSignatureImageType = (typeof ALLOWED_SIGNATURE_IMAGE_TYPES)[number];

export function isSignatureImageFile(value: FormDataEntryValue | null): value is File {
	return (
		value !== null &&
		typeof value !== "string" &&
		typeof value.arrayBuffer === "function" &&
		typeof value.size === "number" &&
		typeof value.type === "string"
	);
}

export function inspectSignatureImage(
	content: ArrayBuffer,
	declaredType: string,
): SignatureImageDimensions {
	const type = normalizeAllowedImageType(declaredType);
	const bytes = new Uint8Array(content);
	const dimensions =
		type === "image/png"
			? inspectPng(bytes)
			: type === "image/gif"
				? inspectGif(bytes)
				: inspectJpeg(bytes);
	if (!dimensions) throw new Error("Image content does not match its declared file type");
	if (
		dimensions.width > MAX_SIGNATURE_IMAGE_WIDTH ||
		dimensions.height > MAX_SIGNATURE_IMAGE_HEIGHT
	) {
		throw new Error(
			`Signature images cannot exceed ${MAX_SIGNATURE_IMAGE_WIDTH} by ${MAX_SIGNATURE_IMAGE_HEIGHT} pixels`,
		);
	}
	return dimensions;
}

export async function storeSignatureAsset(
	env: Pick<CloudflareEnv, "BUCKET" | "DB">,
	input: {
		altText: string;
		content: ArrayBuffer;
		filename: string;
		mailboxId: string;
		type: string;
		uploadedByUserId: string;
	},
): Promise<SignatureAssetMetadata> {
	const type = normalizeAllowedImageType(input.type);
	if (input.content.byteLength === 0) throw new Error("Image file is empty");
	if (input.content.byteLength > MAX_SIGNATURE_ASSET_SIZE) {
		throw new Error("Signature images must be 512 KB or smaller");
	}
	const dimensions = inspectSignatureImage(input.content, type);
	const db = getDb(env);
	const [usage] = await db
		.select({
			count: sql<number>`count(*)`,
			totalSize: sql<number>`coalesce(sum(${signatureAssets.size}), 0)`,
		})
		.from(signatureAssets)
		.where(eq(signatureAssets.mailboxId, input.mailboxId));
	if (Number(usage?.count ?? 0) >= MAX_SIGNATURE_ASSET_COUNT) {
		throw new Error(`A mailbox can store at most ${MAX_SIGNATURE_ASSET_COUNT} signature images`);
	}
	if (Number(usage?.totalSize ?? 0) + input.content.byteLength > MAX_SIGNATURE_ASSETS_TOTAL_SIZE) {
		throw new Error("Signature images exceed the 2 MB mailbox total");
	}

	const id = newId("sigimg");
	const filename = sanitizeFilename(input.filename, type);
	const contentId = `sig.${id}@ccmail.local`;
	const r2Key = `signatures/${input.mailboxId}/${id}/${filename}`;
	await env.BUCKET.put(r2Key, input.content, {
		httpMetadata: { contentType: type },
		customMetadata: { mailboxId: input.mailboxId, assetId: id, filename },
	});
	try {
		await db.insert(signatureAssets).values({
			id,
			mailboxId: input.mailboxId,
			uploadedByUserId: input.uploadedByUserId,
			filename,
			contentType: type,
			size: input.content.byteLength,
			width: dimensions.width,
			height: dimensions.height,
			altText: input.altText.trim(),
			contentId,
			r2Key,
		});
	} catch (error) {
		await env.BUCKET.delete(r2Key);
		throw error;
	}

	return {
		id,
		mailboxId: input.mailboxId,
		filename,
		type,
		size: input.content.byteLength,
		width: dimensions.width,
		height: dimensions.height,
		altText: input.altText.trim(),
		contentId,
		src: `cid:${contentId}`,
		previewUrl: `/api/mailboxes/${input.mailboxId}/signature/assets/${id}`,
		createdAt: new Date(),
	};
}

export async function listSignatureAssets(
	env: Pick<CloudflareEnv, "DB">,
	mailboxId: string,
): Promise<SignatureAssetMetadata[]> {
	const rows = await getDb(env)
		.select()
		.from(signatureAssets)
		.where(eq(signatureAssets.mailboxId, mailboxId));
	return rows.map(toSignatureAssetMetadata);
}

export function toSignatureAssetMetadata(
	asset: typeof signatureAssets.$inferSelect,
): SignatureAssetMetadata {
	return {
		id: asset.id,
		mailboxId: asset.mailboxId,
		filename: asset.filename,
		type: asset.contentType,
		size: asset.size,
		width: asset.width,
		height: asset.height,
		altText: asset.altText,
		contentId: asset.contentId,
		src: `cid:${asset.contentId}`,
		previewUrl: `/api/mailboxes/${asset.mailboxId}/signature/assets/${asset.id}`,
		createdAt: asset.createdAt,
	};
}

function normalizeAllowedImageType(value: string): AllowedSignatureImageType {
	const normalized = value.toLowerCase().split(";", 1)[0]?.trim() ?? "";
	if (!ALLOWED_SIGNATURE_IMAGE_TYPES.includes(normalized as AllowedSignatureImageType)) {
		throw new Error("Use a JPEG, PNG, or GIF signature image");
	}
	return normalized as AllowedSignatureImageType;
}

function sanitizeFilename(value: string, type: AllowedSignatureImageType): string {
	const extension = type === "image/jpeg" ? "jpg" : type.slice("image/".length);
	const normalized = value
		.trim()
		.replace(/[/\\\0]/g, "_")
		.replace(/[^a-zA-Z0-9._ -]/g, "_")
		.slice(0, 200);
	return normalized || `signature.${extension}`;
}

function inspectPng(bytes: Uint8Array): SignatureImageDimensions | null {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const width = view.getUint32(16);
	const height = view.getUint32(20);
	return validDimensions(width, height);
}

function inspectGif(bytes: Uint8Array): SignatureImageDimensions | null {
	if (bytes.length < 10) return null;
	const header = String.fromCharCode(...bytes.slice(0, 6));
	if (header !== "GIF87a" && header !== "GIF89a") return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return validDimensions(view.getUint16(6, true), view.getUint16(8, true));
}

function inspectJpeg(bytes: Uint8Array): SignatureImageDimensions | null {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let offset = 2;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	while (offset + 8 < bytes.length) {
		if (bytes[offset] !== 0xff) {
			offset += 1;
			continue;
		}
		const marker = bytes[offset + 1];
		if (marker === undefined) return null;
		if (marker === 0xd8 || marker === 0xd9) {
			offset += 2;
			continue;
		}
		if (offset + 4 > bytes.length) return null;
		const segmentLength = view.getUint16(offset + 2);
		if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) return null;
		if (isJpegStartOfFrame(marker)) {
			if (segmentLength < 7) return null;
			return validDimensions(view.getUint16(offset + 7), view.getUint16(offset + 5));
		}
		offset += 2 + segmentLength;
	}
	return null;
}

function isJpegStartOfFrame(marker: number): boolean {
	return (
		(marker >= 0xc0 && marker <= 0xc3) ||
		(marker >= 0xc5 && marker <= 0xc7) ||
		(marker >= 0xc9 && marker <= 0xcb) ||
		(marker >= 0xcd && marker <= 0xcf)
	);
}

function validDimensions(width: number, height: number): SignatureImageDimensions | null {
	return width > 0 && height > 0 ? { width, height } : null;
}
