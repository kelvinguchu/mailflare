// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
	SIGNATURE_COLORS,
	SIGNATURE_MARKS,
	createTextRow,
	newRowId,
	normalizeSignatureLink,
	parseSignature,
	scaleImage,
	serializeSignature,
	signatureRowsToText,
	textToSignatureRows,
	validateSignatureRows,
	type SignatureRow,
} from "../src/components/settings/signature-model";
import { removeLegacySignature } from "../src/components/compose/utils";
import { sanitizeMailboxSignature } from "../src/lib/email/signatures";

const parser = new DOMParser();
const CID = "sig.sigimg_abc123@ccmail.local";

function roundTrip(rows: SignatureRow[]) {
	const html = serializeSignature(rows);
	const sanitized = sanitizeMailboxSignature({ html });
	return { html, sanitized };
}

describe("signature editor output", () => {
	it("round-trips every formatting command through the backend sanitizer unchanged", () => {
		const rows: SignatureRow[] = [];
		for (const { mark } of SIGNATURE_MARKS)
			rows.push(createTextRow(`Mark ${mark}`, { marks: [mark] }));
		rows.push(createTextRow("All marks", { marks: SIGNATURE_MARKS.map((item) => item.mark) }));
		for (const color of SIGNATURE_COLORS)
			rows.push(createTextRow(`Color ${color.label}`, { color: color.value }));
		for (const align of ["left", "center", "right"] as const) {
			rows.push(createTextRow(`Align ${align}`, { align }));
		}
		rows.push(
			createTextRow("Website", { href: "https://example.com/path?a=1&b=2", marks: ["bold"] }),
			createTextRow("Email", { href: "mailto:alex@example.com" }),
			createTextRow("Call", { href: "tel:+15551234567" }),
			{ id: newRowId(), kind: "blank" },
			createTextRow(`Quotes " ' & <tags>`),
			{ id: newRowId(), kind: "list", ordered: false, items: ["One", "Two & three"] },
			{ id: newRowId(), kind: "list", ordered: true, items: ["First", "Second"] },
			{
				id: newRowId(),
				kind: "image",
				contentId: CID,
				alt: "Company logo",
				decorative: false,
				width: 200,
				height: 50,
				align: "center",
			},
			{
				id: newRowId(),
				kind: "image",
				contentId: CID,
				alt: "",
				decorative: true,
				width: 120,
				height: 30,
				align: "left",
			},
		);
		const { html, sanitized } = roundTrip(rows);
		expect(sanitized.html).toBe(html);
		expect(sanitized.contentIds).toEqual([CID]);
	});

	it("reads its own output back into the same rows", () => {
		const rows: SignatureRow[] = [
			createTextRow("Alex Rivera", { marks: ["bold"], color: "#10386e" }),
			createTextRow("alex@example.com", { href: "mailto:alex@example.com", align: "center" }),
			{ id: newRowId(), kind: "blank" },
			{ id: newRowId(), kind: "list", ordered: true, items: ["Mon–Fri", "9–5"] },
		];
		const html = serializeSignature(rows);
		const parsed = parseSignature(html, parser);
		expect(parsed && serializeSignature(parsed)).toBe(html);
		expect(parsed?.map((row) => row.kind)).toEqual(["text", "text", "blank", "list"]);
	});

	it("refuses to take over HTML it did not produce", () => {
		const foreign = "<table><tbody><tr><td>Alex</td></tr></tbody></table>";
		expect(parseSignature(foreign, parser)).toBeNull();
		expect(parseSignature("<p><strong>Alex</strong> Rivera</p>", parser)).toBeNull();
	});

	it("matches the backend's plain-text fallback", () => {
		const rows: SignatureRow[] = [
			createTextRow("Alex Rivera", { marks: ["bold"] }),
			{ id: newRowId(), kind: "blank" },
			createTextRow("Example Co", { href: "https://example.com" }),
			{ id: newRowId(), kind: "list", ordered: false, items: ["Sales", "Support"] },
			{
				id: newRowId(),
				kind: "image",
				contentId: CID,
				alt: "Logo",
				decorative: false,
				width: 10,
				height: 10,
				align: "left",
			},
		];
		expect(sanitizeMailboxSignature({ html: serializeSignature(rows) }).text).toBe(
			signatureRowsToText(rows),
		);
	});

	it("drops leading and trailing empty rows and saves nothing for an empty signature", () => {
		expect(serializeSignature([createTextRow(""), { id: newRowId(), kind: "blank" }])).toBeNull();
		expect(
			serializeSignature([
				{ id: newRowId(), kind: "blank" },
				createTextRow("Alex"),
				createTextRow(" "),
			]),
		).toBe('<p style="margin: 0">Alex</p>');
	});

	it("escapes pasted markup as text instead of formatting", () => {
		const pasted = `<img src="https://evil.test/x.png" onerror="alert(1)"><script>alert(1)</script>`;
		const { html, sanitized } = roundTrip([createTextRow(pasted)]);
		expect(sanitized.html).toBe(html);
		expect(sanitized.html).not.toMatch(/<img|<script/);
		expect(sanitized.contentIds).toEqual([]);
	});
});

describe("signature links and images", () => {
	it("normalizes typed links to backend-safe forms and rejects unsafe ones", () => {
		expect(normalizeSignatureLink("https://example.com")).toBe("https://example.com");
		expect(normalizeSignatureLink("example.com/team")).toBe("https://example.com/team");
		expect(normalizeSignatureLink("alex@example.com")).toBe("mailto:alex@example.com");
		expect(normalizeSignatureLink("+1 (555) 123-4567")).toBe("tel:+15551234567");
		expect(normalizeSignatureLink("http://example.com")).toBeNull();
		expect(normalizeSignatureLink("javascript:alert(1)")).toBeNull();
		expect(normalizeSignatureLink("data:text/html,hi")).toBeNull();
	});

	it("never lets remote, data, or unsafe sources survive sanitization", () => {
		const sanitized = sanitizeMailboxSignature({
			html: '<p><img src="https://evil.test/a.png" alt="x"><img src="data:image/png;base64,AA" alt="y"><a href="javascript:alert(1)">x</a></p>',
		});
		expect(sanitized.html).toBe("<p>x</p>");
	});

	it("requires alt text unless an image is marked decorative", () => {
		const image = {
			id: newRowId(),
			kind: "image" as const,
			contentId: CID,
			alt: "",
			decorative: false,
			width: 10,
			height: 10,
			align: "left" as const,
		};
		expect(validateSignatureRows([image])).toHaveLength(1);
		expect(validateSignatureRows([{ ...image, decorative: true }])).toEqual([]);
		expect(validateSignatureRows([{ ...image, alt: "Logo" }])).toEqual([]);
	});

	it("scales wide images proportionally", () => {
		expect(scaleImage({ width: 1200, height: 300 }, 240)).toEqual({ width: 240, height: 60 });
		expect(scaleImage({ width: 100, height: 40 }, 240)).toEqual({ width: 100, height: 40 });
	});

	it("turns plain text into editable rows", () => {
		const rows = textToSignatureRows("Alex\n\nExample Co");
		expect(rows.map((row) => row.kind)).toEqual(["text", "blank", "text"]);
	});
});

describe("composer signature transition", () => {
	it("removes a legacy client-inserted signature so the server adds exactly one", () => {
		const signature = "Alex\nExample Co";
		expect(removeLegacySignature(`Hello\n\n${signature}`, signature)).toBe("Hello");
		expect(removeLegacySignature(`\n\n${signature}\n\nMaya wrote:\n> Hi`, signature)).toBe(
			"\n\nMaya wrote:\n> Hi",
		);
		expect(removeLegacySignature("Hello", signature)).toBe("Hello");
		expect(removeLegacySignature(`Hello\n\n${signature}`, null)).toBe(`Hello\n\n${signature}`);
	});
});
