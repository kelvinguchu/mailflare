/**
 * A deliberately small signature document model. Every row serializes to markup the backend
 * signature sanitizer keeps byte-for-byte, so what the editor shows is what gets saved.
 */

export type SignatureMark = "bold" | "italic" | "underline" | "strike";
export type SignatureAlign = "left" | "center" | "right";

export type SignatureTextRow = {
	id: string;
	kind: "text";
	text: string;
	marks: SignatureMark[];
	href: string;
	color: string;
	align: SignatureAlign;
};

export type SignatureListRow = {
	id: string;
	kind: "list";
	ordered: boolean;
	items: string[];
};

export type SignatureBlankRow = { id: string; kind: "blank" };

export type SignatureImageRow = {
	id: string;
	kind: "image";
	contentId: string;
	alt: string;
	decorative: boolean;
	width: number;
	height: number;
	align: SignatureAlign;
};

export type SignatureRow =
	SignatureTextRow | SignatureListRow | SignatureBlankRow | SignatureImageRow;

export const SIGNATURE_MARKS: Array<{ mark: SignatureMark; label: string; tag: string }> = [
	{ mark: "bold", label: "Bold", tag: "strong" },
	{ mark: "italic", label: "Italic", tag: "em" },
	{ mark: "underline", label: "Underline", tag: "u" },
	{ mark: "strike", label: "Strikethrough", tag: "s" },
];

/** Hex colors only, from a fixed set that stays readable on white email backgrounds. */
export const SIGNATURE_COLORS: Array<{ value: string; label: string }> = [
	{ value: "", label: "Default" },
	{ value: "#111827", label: "Black" },
	{ value: "#4b5563", label: "Gray" },
	{ value: "#10386e", label: "Navy" },
	{ value: "#1d4ed8", label: "Blue" },
	{ value: "#047857", label: "Green" },
	{ value: "#b91c1c", label: "Red" },
];

const CONTENT_ID_PATTERN = /^sig\.[a-zA-Z0-9_-]+@ccmail\.local$/;
const SAFE_LINK_PATTERN = /^(?:https:\/\/|mailto:|tel:)[^\s\u0000-\u001f\u007f]+$/i;
const MAX_ALT_LENGTH = 200;
const LIST_STYLE = "margin: 0; padding-left: 20px";

let rowCounter = 0;
export function newRowId(): string {
	rowCounter += 1;
	return `row-${rowCounter}`;
}

export function createTextRow(
	text = "",
	overrides: Partial<SignatureTextRow> = {},
): SignatureTextRow {
	return {
		id: newRowId(),
		kind: "text",
		text,
		marks: [],
		href: "",
		color: "",
		align: "left",
		...overrides,
	};
}

export function escapeSignatureHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function paragraphStyle(align: SignatureAlign, color = ""): string {
	const declarations = ["margin: 0"];
	if (align !== "left") declarations.push(`text-align: ${align}`);
	if (color) declarations.push(`color: ${color}`);
	return declarations.join("; ");
}

function serializeRow(row: SignatureRow): string {
	if (row.kind === "blank") return `<p style="margin: 0"><br></p>`;
	if (row.kind === "list") {
		const items = row.items.map((item) => item.trim()).filter(Boolean);
		if (items.length === 0) return "";
		const tag = row.ordered ? "ol" : "ul";
		return `<${tag} style="${LIST_STYLE}">${items.map((item) => `<li>${escapeSignatureHtml(item)}</li>`).join("")}</${tag}>`;
	}
	if (row.kind === "image") {
		const alt = row.decorative ? "" : row.alt.trim().slice(0, MAX_ALT_LENGTH);
		return `<p style="${paragraphStyle(row.align)}"><img src="cid:${row.contentId}" width="${row.width}" height="${row.height}" alt="${escapeSignatureHtml(alt)}"></p>`;
	}
	const text = row.text.trim();
	if (!text) return `<p style="${paragraphStyle(row.align, row.color)}"><br></p>`;
	let inner = escapeSignatureHtml(text);
	for (const { mark, tag } of [...SIGNATURE_MARKS].reverse()) {
		if (row.marks.includes(mark)) inner = `<${tag}>${inner}</${tag}>`;
	}
	if (row.href) inner = `<a href="${escapeSignatureHtml(row.href)}">${inner}</a>`;
	return `<p style="${paragraphStyle(row.align, row.color)}">${inner}</p>`;
}

/** Signature HTML for the API, or null when the signature is empty. */
export function serializeSignature(rows: SignatureRow[]): string | null {
	const meaningful = trimBlankRows(rows);
	const html = meaningful.map(serializeRow).join("");
	return html || null;
}

function trimBlankRows(rows: SignatureRow[]): SignatureRow[] {
	const isEmpty = (row: SignatureRow) =>
		row.kind === "blank" ||
		(row.kind === "text" && !row.text.trim()) ||
		(row.kind === "list" && row.items.every((item) => !item.trim()));
	let start = 0;
	let end = rows.length;
	while (start < end && isEmpty(rows[start])) start += 1;
	while (end > start && isEmpty(rows[end - 1])) end -= 1;
	return rows.slice(start, end);
}

function readParagraphStyle(style: string | null): { align: SignatureAlign; color: string } | null {
	const declarations = new Map<string, string>();
	for (const part of (style ?? "").split(";")) {
		const [property, ...value] = part.split(":");
		if (property?.trim()) declarations.set(property.trim(), value.join(":").trim());
	}
	const align = (declarations.get("text-align") ?? "left") as SignatureAlign;
	if (!["left", "center", "right"].includes(align)) return null;
	return { align, color: declarations.get("color") ?? "" };
}

function parseTextParagraph(paragraph: Element): SignatureTextRow | SignatureBlankRow | null {
	const style = readParagraphStyle(paragraph.getAttribute("style"));
	if (!style) return null;
	const children = Array.from(paragraph.childNodes);
	if (children.length === 1 && children[0].nodeName === "BR") {
		return style.align === "left" && !style.color
			? { id: newRowId(), kind: "blank" }
			: createTextRow("", style);
	}
	let node: Element | null = paragraph;
	let href = "";
	const marks: SignatureMark[] = [];
	while (node && node.childNodes.length === 1 && node.firstChild?.nodeType === 1) {
		const child = node.firstChild as Element;
		const tag = child.tagName.toLowerCase();
		if (tag === "a") href = child.getAttribute("href") ?? "";
		const mark = SIGNATURE_MARKS.find((item) => item.tag === tag)?.mark;
		if (mark) marks.push(mark);
		if (tag !== "a" && !mark) return null;
		node = child;
	}
	if (!node || node.childNodes.length !== 1 || node.firstChild?.nodeType !== 3) return null;
	return createTextRow(node.textContent ?? "", {
		...style,
		href,
		marks: SIGNATURE_MARKS.map((item) => item.mark).filter((mark) => marks.includes(mark)),
	});
}

/**
 * Reads saved signature HTML back into rows. Returns null when the HTML contains anything the
 * editor did not produce, so it can be kept untouched instead of silently reformatted.
 */
export function parseSignature(
	html: string | null | undefined,
	parser: DOMParser,
): SignatureRow[] | null {
	if (!html) return [];
	const document = parser.parseFromString(`<body>${html}</body>`, "text/html");
	const rows: SignatureRow[] = [];
	for (const element of Array.from(document.body.children)) {
		const tag = element.tagName.toLowerCase();
		if (tag === "ul" || tag === "ol") {
			rows.push({
				id: newRowId(),
				kind: "list",
				ordered: tag === "ol",
				items: Array.from(element.children).map((item) => item.textContent ?? ""),
			});
			continue;
		}
		if (tag !== "p") return null;
		const image = element.children.length === 1 ? element.querySelector(":scope > img") : null;
		if (image) {
			const style = readParagraphStyle(element.getAttribute("style"));
			const contentId = (image.getAttribute("src") ?? "").replace(/^cid:/, "");
			if (!style || !CONTENT_ID_PATTERN.test(contentId)) return null;
			const alt = image.getAttribute("alt") ?? "";
			rows.push({
				id: newRowId(),
				kind: "image",
				contentId,
				alt,
				decorative: alt === "",
				width: Number(image.getAttribute("width")) || 0,
				height: Number(image.getAttribute("height")) || 0,
				align: style.align,
			});
			continue;
		}
		const row = parseTextParagraph(element);
		if (!row) return null;
		rows.push(row);
	}
	return serializeSignature(rows) === html ? rows : null;
}

/** Mirrors how the backend derives the plain-text signature from HTML. */
export function signatureRowsToText(rows: SignatureRow[]): string {
	const lines: string[] = [];
	for (const row of trimBlankRows(rows)) {
		if (row.kind === "text" && row.text.trim()) lines.push(row.text.trim());
		if (row.kind === "list") lines.push(...row.items.map((item) => item.trim()).filter(Boolean));
	}
	return lines.join("\n");
}

export function textToSignatureRows(text: string | null | undefined): SignatureRow[] {
	const lines = (text ?? "").replace(/\r\n?/g, "\n").split("\n");
	if (lines.length === 1 && !lines[0].trim()) return [createTextRow()];
	return lines.map((line) =>
		line.trim() ? createTextRow(line.trim()) : { id: newRowId(), kind: "blank" },
	);
}

/**
 * Accepts what people usually type for a link and returns a backend-safe URL, or null when the
 * value can't be made safe. Plain `http:` links are refused because the sanitizer drops them.
 */
export function normalizeSignatureLink(value: string): string | null {
	const input = value.trim();
	if (!input) return "";
	if (SAFE_LINK_PATTERN.test(input)) return input;
	if (/^[^@\s/:]+@[^@\s/:]+\.[^@\s/:]+$/.test(input)) return `mailto:${input}`;
	if (/^\+?[\d\s().-]{6,}$/.test(input)) return `tel:${input.replace(/[\s().-]/g, "")}`;
	if (/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#]\S*)?$/i.test(input))
		return `https://${input}`;
	return null;
}

export type SignatureIssue = { rowId: string; message: string };

/** Problems that must be fixed before saving, attached to the row that has them. */
export function validateSignatureRows(rows: SignatureRow[]): SignatureIssue[] {
	const issues: SignatureIssue[] = [];
	for (const row of rows) {
		if (row.kind === "image" && !row.decorative && !row.alt.trim()) {
			issues.push({
				rowId: row.id,
				message: "Describe this image, or mark it as decorative.",
			});
		}
		if (row.kind === "text" && row.href && !SAFE_LINK_PATTERN.test(row.href)) {
			issues.push({
				rowId: row.id,
				message: "Links must start with https://, mailto:, or tel:.",
			});
		}
	}
	return issues;
}

export function signatureContentIds(rows: SignatureRow[]): string[] {
	return rows.flatMap((row) => (row.kind === "image" ? [row.contentId] : []));
}

/** Scales an image to a display width while keeping its proportions. */
export function scaleImage(
	natural: { width: number; height: number },
	maxWidth: number,
): { width: number; height: number } {
	if (natural.width <= maxWidth) return { width: natural.width, height: natural.height };
	return {
		width: maxWidth,
		height: Math.max(1, Math.round((natural.height * maxWidth) / natural.width)),
	};
}
