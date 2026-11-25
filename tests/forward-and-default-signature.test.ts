import { parseDocument } from "htmlparser2";
import { isTag, type Element } from "domhandler";
import { describe, expect, it } from "vitest";
import { buildDefaultSignature } from "@/lib/email/default-signature";
import { DEFAULT_SIGNATURE_LOGO } from "@/lib/email/default-signature-assets";
import { chooseForwardAttachments, embeddableEmailHtml } from "@/lib/email/forward";
import { getListedAttachments, normalizeContentId } from "@/lib/email/inline-parts";
import { MAX_TOTAL_ATTACHMENT_SIZE } from "@/lib/email/limits";
import { parseRawMime } from "@/lib/email/parse";
import { toEmailServiceAttachment } from "@/lib/email/provider-attachment";

describe("embeddableEmailHtml", () => {
	it("keeps body and styles, and drops document wrappers and scripts", () => {
		const html = embeddableEmailHtml(
			`<!doctype html><html><head><title>x</title><style>.a{color:red}</style></head><body class="b"><p class="a">Hi</p><script>alert(1)</script></body></html>`,
		);
		expect(html).toBe(`<div><style>.a{color:red}</style><p class="a">Hi</p></div>`);
	});

	it("handles fragments with no body element", () => {
		expect(embeddableEmailHtml(`<p>Hi</p><base href="https://x.test">`)).toBe(
			`<div><p>Hi</p></div>`,
		);
	});
});

describe("chooseForwardAttachments", () => {
	const file = (name: string, size: number, disposition = "attachment") => ({
		name,
		size,
		disposition,
	});

	it("keeps inline images first and omits what does not fit", () => {
		const big = file("big.pdf", MAX_TOTAL_ATTACHMENT_SIZE);
		const inline = file("logo.png", 1000, "inline");
		const small = file("note.txt", 1000);
		const { included, omitted } = chooseForwardAttachments([big, small, inline], {
			count: 0,
			bytes: 0,
		});
		expect(included.map((item) => item.name)).toEqual(["logo.png", "note.txt"]);
		expect(omitted.map((item) => item.name)).toEqual(["big.pdf"]);
	});

	it("counts what the message is already sending", () => {
		const { included } = chooseForwardAttachments([file("a.pdf", 10)], {
			count: 10,
			bytes: 0,
		});
		expect(included).toEqual([]);
	});
});

function elements(html: string): Element[] {
	const found: Element[] = [];
	const visit = (nodes: ReturnType<typeof parseDocument>["children"]) => {
		for (const node of nodes) {
			if (!isTag(node)) continue;
			found.push(node);
			visit(node.children);
		}
	};
	visit(parseDocument(html).children);
	return found;
}

function closest(element: Element, tag: string): Element | null {
	let current = element.parent;
	while (current) {
		if (isTag(current) && current.name === tag) return current;
		current = current.parent;
	}
	return null;
}

function pngSize(base64: string): { width: number; height: number } {
	const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
	const view = new DataView(bytes.buffer);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("buildDefaultSignature", () => {
	const signature = buildDefaultSignature({
		name: "Rukia <Ali>",
		fromAddr: "CaliberCode <contact@calibercode.io>",
	});
	const html = signature?.html ?? "";
	const images = elements(html).filter((element) => element.name === "img");
	const imageFor = (contentId: string) =>
		images.find((image) => image.attribs.src === `cid:${contentId}`);

	it("puts the logo first, then the name, the contact lines, the address and the icons", () => {
		expect(signature).not.toBeNull();
		const positions = [
			"sig.default-logo",
			"Rukia &lt;Ali&gt;",
			"Phone: <a",
			"+254 733 313 314",
			"Mobile: <a",
			"+254 753 033 333",
			"WhatsApp: <a",
			"+254780 333 331",
			"Email: <a",
			"contact@calibercode.io</a>",
			"Wabera Str, Jubilee Insurance Hse,",
			"1st Floor #113, 100010-00101 Nairobi",
			"sig.default-facebook",
			"sig.default-linkedin",
			"sig.default-instagram",
		].map((part) => html.indexOf(part));
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	it("is table based with inline styles only", () => {
		const tags = new Set(elements(html).map((element) => element.name));
		expect([...tags].sort()).toEqual(["a", "img", "table", "tbody", "td", "tr"]);
		expect(html).not.toMatch(/\sclass=/);
		expect(html).not.toMatch(/<style/i);
		expect(html).toMatch(/font-weight: bold; color: #10386e">Rukia &lt;Ali&gt;</);
	});

	it("keeps the social icons side by side in one row with even gaps", () => {
		const icons = ["facebook", "linkedin", "instagram"].map((label) =>
			imageFor(`sig.default-${label}@ccmail.local`),
		);
		expect(icons.every(Boolean)).toBe(true);
		const cells = icons.map((icon) => closest(icon!, "td"));
		const rows = new Set(cells.map((cell) => (cell ? closest(cell, "tr") : null)));
		expect(rows.size).toBe(1);
		expect(new Set(cells).size).toBe(3);
		expect(cells.map((cell) => cell?.attribs.style)).toEqual([
			"padding: 0 8px 0 0; vertical-align: middle",
			"padding: 0 8px 0 0; vertical-align: middle",
			"padding: 0; vertical-align: middle",
		]);
		for (const icon of icons) {
			expect(icon?.attribs).toMatchObject({ width: "24", height: "24" });
			expect(icon?.attribs.style).toContain("display: block");
			expect(icon?.attribs.alt).toBeTruthy();
		}
	});

	it("renders the logo at a fixed width with automatic height from a 2x image", () => {
		const logo = imageFor("sig.default-logo@ccmail.local");
		expect(logo?.attribs).toMatchObject({ width: "160", alt: "CaliberCode" });
		expect(logo?.attribs.height).toBeUndefined();
		expect(logo?.attribs.style).toBe("display: block; width: 160px; height: auto; border: 0");
		const size = pngSize(DEFAULT_SIGNATURE_LOGO);
		expect(size.width).toBeGreaterThanOrEqual(2 * 160);
		// The brand mark (360 x 217) plus 8px of clear space on every side, so nothing touches
		// an edge and the height follows the width without cropping.
		expect(size).toEqual({ width: 376, height: 233 });
	});

	it("sends every image as an inline part with a Content-ID the HTML references", () => {
		const parts = signature?.attachments ?? [];
		expect(parts.map((part) => part.filename)).toEqual([
			"calibercode-logo.png",
			"facebook.png",
			"linkedin.png",
			"instagram.png",
		]);
		for (const part of parts) {
			expect(part).toMatchObject({ type: "image/png", disposition: "inline" });
			expect(html).toContain(`src="cid:${part.contentId}"`);
			const provider = toEmailServiceAttachment(part);
			expect(provider).toMatchObject({
				disposition: "inline",
				contentId: part.contentId,
				filename: part.filename,
				type: "image/png",
			});
			expect(provider.contentId).not.toMatch(/[<>]/);
		}
		expect(images).toHaveLength(parts.length);
	});

	it("keeps a plain-text alternative with the same details", () => {
		expect(signature?.text).toBe(
			[
				"Rukia <Ali>",
				"CaliberCode",
				"",
				"Phone: +254 733 313 314",
				"Mobile: +254 753 033 333",
				"WhatsApp: +254780 333 331",
				"Email: contact@calibercode.io",
				"Wabera Str, Jubilee Insurance Hse,",
				"1st Floor #113, 100010-00101 Nairobi",
				"",
				"Facebook: https://web.facebook.com/calibercode/",
				"LinkedIn: https://www.linkedin.com/company/calibercodeltd/",
				"Instagram: https://www.instagram.com/calibercode/",
			].join("\n"),
		);
	});

	it("leaves out the name row when the account has no name", () => {
		const unnamed = buildDefaultSignature({ name: "  ", fromAddr: "ops@calibercode.io" });
		expect(unnamed?.html).not.toContain("color: #10386e");
		expect(unnamed?.text.startsWith("CaliberCode\n\nPhone:")).toBe(true);
	});

	it("only applies to CaliberCode addresses", () => {
		expect(buildDefaultSignature({ name: "A", fromAddr: "a@example.com" })).toBeNull();
	});
});

describe("toEmailServiceAttachment", () => {
	const content = new Uint8Array([1, 2, 3]).buffer;

	it("sends a bare Content-ID, even for parts read from received mail", () => {
		expect(
			toEmailServiceAttachment({
				filename: "chart.png",
				type: "image/png",
				content,
				disposition: "inline",
				contentId: " <ii_chart@mail.example> ",
			}),
		).toEqual({
			disposition: "inline",
			contentId: "ii_chart@mail.example",
			filename: "chart.png",
			type: "image/png",
			content,
		});
		expect(normalizeContentId("<<a@b>>")).toBe("a@b");
		expect(normalizeContentId("<>")).toBeNull();
	});

	it("sends an inline part without a Content-ID, and any file, as an attachment", () => {
		for (const part of [
			{ disposition: "inline" as const, contentId: null },
			{ disposition: "inline" as const, contentId: "  " },
			{ disposition: "attachment" as const, contentId: "file@x" },
		]) {
			expect(
				toEmailServiceAttachment({ filename: "a.pdf", type: "application/pdf", content, ...part }),
			).toEqual({ disposition: "attachment", filename: "a.pdf", type: "application/pdf", content });
		}
	});
});

describe("listing attachments under a message", () => {
	const part = (
		filename: string,
		disposition: "inline" | "attachment",
		contentId: string | null,
	) => ({ filename, disposition, contentId });
	const html = `<p>Hi</p><img src="cid:sig.default-logo@ccmail.local"><img src="cid:photo@x">`;

	it("hides inline images the body draws, including stored IDs with angle brackets", () => {
		const listed = getListedAttachments(
			[
				part("calibercode-logo.png", "inline", "sig.default-logo@ccmail.local"),
				part("attachment-2", "inline", "<photo@x>"),
				part("report.pdf", "attachment", null),
				part("unused.png", "inline", "<unused@x>"),
				part("explicit.png", "attachment", "<photo@x>"),
			],
			html,
		);
		expect(listed.map((item) => item.filename)).toEqual([
			"report.pdf",
			"unused.png",
			"explicit.png",
		]);
	});

	it("lists everything when there is no HTML body to draw the images", () => {
		expect(
			getListedAttachments([part("logo.png", "inline", "sig.default-logo@ccmail.local")], null),
		).toHaveLength(1);
	});

	it("stores received inline images as inline only when the HTML draws them", async () => {
		const png = btoa(String.fromCharCode(...new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])));
		const raw = new TextEncoder().encode(
			[
				"From: sender@calibercode.io",
				"To: someone@example.com",
				"Subject: Signed",
				"MIME-Version: 1.0",
				'Content-Type: multipart/mixed; boundary="mixed"',
				"",
				"--mixed",
				'Content-Type: multipart/related; boundary="related"',
				"",
				"--related",
				"Content-Type: text/html; charset=utf-8",
				"",
				'<p>Hello</p><img src="cid:sig.default-logo@ccmail.local" alt="CaliberCode">',
				"--related",
				"Content-Type: image/png",
				"Content-Transfer-Encoding: base64",
				"Content-ID: <sig.default-logo@ccmail.local>",
				"",
				png,
				"--related",
				"Content-Type: image/png",
				"Content-Transfer-Encoding: base64",
				"Content-Disposition: inline",
				"Content-ID: <not-drawn@ccmail.local>",
				"",
				png,
				"--related--",
				"--mixed",
				'Content-Type: application/pdf; name="quote.pdf"',
				"Content-Transfer-Encoding: base64",
				'Content-Disposition: attachment; filename="quote.pdf"',
				"",
				png,
				"--mixed--",
				"",
			].join("\r\n"),
		).buffer;
		const parsed = await parseRawMime(raw);
		expect(
			parsed.attachments.map(({ filename, disposition, contentId }) => ({
				filename,
				disposition,
				contentId,
			})),
		).toEqual([
			{
				filename: "attachment-1",
				disposition: "inline",
				contentId: "<sig.default-logo@ccmail.local>",
			},
			{
				filename: "attachment-2",
				disposition: "attachment",
				contentId: "<not-drawn@ccmail.local>",
			},
			{ filename: "quote.pdf", disposition: "attachment", contentId: null },
		]);
		expect(
			getListedAttachments(
				parsed.attachments.map((item) => ({
					filename: item.filename,
					disposition: item.disposition ?? "attachment",
					contentId: item.contentId ?? null,
				})),
				parsed.html,
			).map((item) => item.filename),
		).toEqual(["attachment-2", "quote.pdf"]);
	});
});
