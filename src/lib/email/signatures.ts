import { parseDocument } from "htmlparser2";
import { isTag, isText, type AnyNode } from "domhandler";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { mailboxes, signatureAssets } from "@/db/schema";
import type { AttachmentContent } from "./attachment-types";

export const MAX_SIGNATURE_HTML_LENGTH = 50_000;
export const MAX_SIGNATURE_TEXT_LENGTH = 10_000;

const CONTENT_ID_PATTERN = /^sig\.[a-zA-Z0-9_-]+@ccmail\.local$/;
const SAFE_LINK_PATTERN = /^(?:https:\/\/|mailto:|tel:)/i;
const CSS_COLOR_PATTERN = /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i;
const CSS_SIZE_PATTERN = /^(?:0|\d+(?:\.\d+)?(?:px|pt|em|rem|%))$/i;
const CSS_SPACING_PATTERN =
	/^(?:0|\d+(?:\.\d+)?(?:px|pt|em|rem))(?:\s+(?:0|\d+(?:\.\d+)?(?:px|pt|em|rem))){0,3}$/i;
const ALLOWED_TAGS = new Set([
	"a",
	"b",
	"br",
	"div",
	"em",
	"i",
	"img",
	"li",
	"ol",
	"p",
	"s",
	"small",
	"span",
	"strong",
	"table",
	"tbody",
	"td",
	"tr",
	"u",
	"ul",
]);
const DROP_CONTENT_TAGS = new Set([
	"base",
	"embed",
	"iframe",
	"math",
	"object",
	"script",
	"style",
	"svg",
]);
const VOID_TAGS = new Set(["br", "img"]);
const BLOCK_TAGS = new Set(["div", "li", "ol", "p", "table", "tr", "ul"]);
const GLOBAL_ATTRIBUTES = new Set(["style", "title"]);
const TAG_ATTRIBUTES: Record<string, Set<string>> = {
	a: new Set(["href"]),
	img: new Set(["alt", "height", "src", "width"]),
	table: new Set(["border", "cellpadding", "cellspacing", "width"]),
	td: new Set(["align", "colspan", "rowspan", "valign", "width"]),
};
const STYLE_VALIDATORS: Record<string, RegExp[]> = {
	color: [CSS_COLOR_PATTERN],
	"background-color": [CSS_COLOR_PATTERN],
	"font-family": [/^[a-z0-9 ,.'"-]+$/i],
	"font-size": [CSS_SIZE_PATTERN],
	"font-style": [/^(?:normal|italic)$/i],
	"font-weight": [/^(?:normal|bold|[1-9]00)$/i],
	"line-height": [CSS_SIZE_PATTERN, /^\d+(?:\.\d+)?$/],
	margin: [CSS_SPACING_PATTERN],
	"margin-bottom": [CSS_SIZE_PATTERN],
	"margin-left": [CSS_SIZE_PATTERN],
	"margin-right": [CSS_SIZE_PATTERN],
	"margin-top": [CSS_SIZE_PATTERN],
	padding: [CSS_SPACING_PATTERN],
	"padding-bottom": [CSS_SIZE_PATTERN],
	"padding-left": [CSS_SIZE_PATTERN],
	"padding-right": [CSS_SIZE_PATTERN],
	"padding-top": [CSS_SIZE_PATTERN],
	"text-align": [/^(?:left|center|right)$/i],
	"text-decoration": [/^(?:none|underline|line-through)$/i],
	"vertical-align": [/^(?:baseline|middle|top|bottom)$/i],
	width: [CSS_SIZE_PATTERN, /^auto$/i],
	"max-width": [CSS_SIZE_PATTERN, /^none$/i],
	height: [CSS_SIZE_PATTERN, /^auto$/i],
};

export type SanitizedMailboxSignature = {
	html: string | null;
	text: string | null;
	contentIds: string[];
};

export type RenderedMailboxSignature = {
	html: string | undefined;
	text: string | undefined;
	attachments: AttachmentContent[];
	version: number | null;
};

export function sanitizeMailboxSignature(input: {
	html?: string | null;
	text?: string | null;
}): SanitizedMailboxSignature {
	const html = sanitizeSignatureHtml(input.html);
	const suppliedText = normalizeSignatureText(input.text);
	const text = suppliedText ?? (html ? signatureHtmlToText(html) : null);
	return { html, text, contentIds: extractSignatureContentIds(html) };
}

export async function assertSignatureAssetsBelongToMailbox(
	env: Pick<CloudflareEnv, "DB">,
	mailboxId: string,
	contentIds: readonly string[],
): Promise<void> {
	if (contentIds.length === 0) return;
	const assets = await getDb(env)
		.select({ contentId: signatureAssets.contentId })
		.from(signatureAssets)
		.where(eq(signatureAssets.mailboxId, mailboxId));
	const available = new Set(assets.map((asset) => asset.contentId));
	const missing = contentIds.filter((contentId) => !available.has(contentId));
	if (missing.length > 0) {
		throw new Error("Signature contains an image that does not belong to this mailbox");
	}
}

export async function renderMailboxSignatureForSend(
	env: Pick<CloudflareEnv, "DB" | "BUCKET">,
	mailboxId: string,
	input: { html?: string; text?: string },
): Promise<RenderedMailboxSignature> {
	const [mailbox] = await getDb(env)
		.select({
			signature: mailboxes.signature,
			signatureText: mailboxes.signatureText,
			signatureHtml: mailboxes.signatureHtml,
			signatureVersion: mailboxes.signatureVersion,
		})
		.from(mailboxes)
		.where(eq(mailboxes.id, mailboxId))
		.limit(1);
	if (!mailbox) throw new Error("Mailbox not found");

	const signatureText = mailbox.signatureText ?? mailbox.signature;
	const signatureHtml = mailbox.signatureHtml;
	const bodyText = input.text ?? (input.html ? (signatureHtmlToText(input.html) ?? "") : "");
	const bodyHtml = input.html ?? textToEmailHtml(input.text ?? "");
	if (!signatureText && !signatureHtml) {
		return {
			html: bodyHtml || undefined,
			text: bodyText || undefined,
			attachments: [],
			version: mailbox.signatureVersion,
		};
	}

	const text = appendTextSignature(bodyText, signatureText);
	const htmlSignature = signatureHtml ?? (signatureText ? textToEmailHtml(signatureText) : null);
	const html = appendHtmlSignature(bodyHtml, htmlSignature, mailbox.signatureVersion);
	const attachments = await loadSignatureAttachments(env, mailboxId, signatureHtml);

	return {
		html: html || undefined,
		text: text || undefined,
		attachments,
		version: mailbox.signatureVersion,
	};
}

export function extractSignatureContentIds(html: string | null | undefined): string[] {
	if (!html) return [];
	const values = new Set<string>();
	for (const match of html.matchAll(/\bsrc\s*=\s*["']cid:([^"']+)["']/gi)) {
		const contentId = match[1]?.trim();
		if (contentId && CONTENT_ID_PATTERN.test(contentId)) values.add(contentId);
	}
	return [...values];
}

function sanitizeSignatureHtml(value: string | null | undefined): string | null {
	const source = value?.trim() ?? "";
	if (!source) return null;
	const document = parseDocument(source, { decodeEntities: true, lowerCaseAttributeNames: true });
	const sanitized = document.children
		.map((node) => renderSanitizedNode(node, 0))
		.join("")
		.trim();
	if (!sanitized) return null;
	if (sanitized.length > MAX_SIGNATURE_HTML_LENGTH) {
		throw new Error(`Signature HTML cannot exceed ${MAX_SIGNATURE_HTML_LENGTH} characters`);
	}
	return sanitized;
}

function normalizeSignatureText(value: string | null | undefined): string | null {
	if (value === undefined || value === null) return null;
	const normalized = value.replace(/\r\n?/g, "\n").trim();
	if (!normalized) return null;
	if (normalized.length > MAX_SIGNATURE_TEXT_LENGTH) {
		throw new Error(`Signature text cannot exceed ${MAX_SIGNATURE_TEXT_LENGTH} characters`);
	}
	return normalized;
}

function signatureHtmlToText(html: string): string | null {
	const document = parseDocument(html, { decodeEntities: true });
	const text = document.children
		.map(renderTextNode)
		.join("")
		.replace(/\u00a0/g, " ")
		.split("\n")
		.map((line) => line.trim())
		.join("\n")
		.replace(/\n{2,}/g, "\n")
		.trim();
	return text || null;
}

function renderSanitizedNode(node: AnyNode, depth: number): string {
	if (depth > 20) return "";
	if (isText(node)) return escapeHtml(node.data);
	if (!isTag(node)) return "";
	const tag = node.name.toLowerCase();
	if (DROP_CONTENT_TAGS.has(tag)) return "";
	const children = node.children.map((child) => renderSanitizedNode(child, depth + 1)).join("");
	if (!ALLOWED_TAGS.has(tag)) return children;
	const attributes = sanitizeAttributes(tag, node.attribs);
	if (tag === "img" && !attributes.src) return "";
	const serializedAttributes = Object.entries(attributes)
		.map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
		.join("");
	if (VOID_TAGS.has(tag)) return `<${tag}${serializedAttributes}>`;
	return `<${tag}${serializedAttributes}>${children}</${tag}>`;
}

function renderTextNode(node: AnyNode): string {
	if (isText(node)) return node.data;
	if (!isTag(node) || DROP_CONTENT_TAGS.has(node.name.toLowerCase())) return "";
	const tag = node.name.toLowerCase();
	if (tag === "br") return "\n";
	const text = node.children.map(renderTextNode).join("");
	return BLOCK_TAGS.has(tag) ? `${text}\n` : text;
}

function sanitizeAttributes(
	tag: string,
	attributes: Record<string, string>,
): Record<string, string> {
	const sanitized: Record<string, string> = {};
	for (const [rawName, rawValue] of Object.entries(attributes)) {
		const name = rawName.toLowerCase();
		if (name.startsWith("on")) continue;
		if (!GLOBAL_ATTRIBUTES.has(name) && !TAG_ATTRIBUTES[tag]?.has(name)) continue;
		const value = rawValue.trim();
		if (!value || /[\u0000-\u001f\u007f]/.test(value)) continue;
		if (name === "style") {
			const style = sanitizeInlineStyle(value);
			if (style) sanitized.style = style;
			continue;
		}
		if (name === "href") {
			if (SAFE_LINK_PATTERN.test(value)) sanitized.href = value.slice(0, 2_048);
			continue;
		}
		if (name === "src") {
			const contentId = value.toLowerCase().startsWith("cid:") ? value.slice(4) : "";
			if (CONTENT_ID_PATTERN.test(contentId)) sanitized.src = `cid:${contentId}`;
			continue;
		}
		if (name === "alt" || name === "title") {
			sanitized[name] = value.slice(0, 200);
			continue;
		}
		if (
			["border", "cellpadding", "cellspacing", "colspan", "height", "rowspan", "width"].includes(
				name,
			)
		) {
			if (/^\d{1,4}$/.test(value)) sanitized[name] = value;
			continue;
		}
		if (name === "align" && /^(?:left|center|right)$/i.test(value)) {
			sanitized[name] = value.toLowerCase();
			continue;
		}
		if (name === "valign" && /^(?:baseline|bottom|middle|top)$/i.test(value)) {
			sanitized[name] = value.toLowerCase();
		}
	}
	if (tag === "img" && sanitized.src && !("alt" in sanitized)) sanitized.alt = "";
	return sanitized;
}

function sanitizeInlineStyle(value: string): string {
	if (
		/[\\\u0000-\u001f\u007f]/.test(value) ||
		/url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding/i.test(value)
	) {
		return "";
	}
	const declarations: string[] = [];
	for (const rawDeclaration of value.split(";")) {
		const separator = rawDeclaration.indexOf(":");
		if (separator <= 0) continue;
		const property = rawDeclaration.slice(0, separator).trim().toLowerCase();
		const propertyValue = rawDeclaration.slice(separator + 1).trim();
		const validators = STYLE_VALIDATORS[property];
		if (!validators?.some((validator) => validator.test(propertyValue))) continue;
		declarations.push(`${property}: ${propertyValue}`);
	}
	return declarations.join("; ");
}

function appendTextSignature(body: string, signature: string | null): string {
	const normalizedBody = body.trimEnd();
	if (!signature) return normalizedBody;
	return normalizedBody ? `${normalizedBody}\n\n${signature}` : signature;
}

function appendHtmlSignature(body: string, signature: string | null, version: number): string {
	const normalizedBody = body.trim();
	if (!signature) return normalizedBody;
	const block = `<div data-ccmail-signature="${version}"><br>${signature}</div>`;
	return normalizedBody ? `${normalizedBody}${block}` : block;
}

function textToEmailHtml(value: string): string {
	if (!value) return "";
	return `<div>${escapeHtml(value).replace(/\n/g, "<br>")}</div>`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

async function loadSignatureAttachments(
	env: Pick<CloudflareEnv, "DB" | "BUCKET">,
	mailboxId: string,
	html: string | null,
): Promise<AttachmentContent[]> {
	const contentIds = extractSignatureContentIds(html);
	if (contentIds.length === 0) return [];
	const rows = await getDb(env)
		.select()
		.from(signatureAssets)
		.where(eq(signatureAssets.mailboxId, mailboxId));
	const byContentId = new Map(rows.map((asset) => [asset.contentId, asset]));
	return Promise.all(
		contentIds.map(async (contentId) => {
			const asset = byContentId.get(contentId);
			if (!asset) throw new Error("A signature image is no longer available");
			const object = await env.BUCKET.get(asset.r2Key);
			if (!object) throw new Error("A stored signature image is missing");
			return {
				filename: asset.filename,
				type: asset.contentType,
				content: await object.arrayBuffer(),
				disposition: "inline" as const,
				contentId: asset.contentId,
			};
		}),
	);
}
