import { describe, expect, it } from "vitest";
import { buildDefaultSignature } from "@/lib/email/default-signature";
import { chooseForwardAttachments, embeddableEmailHtml } from "@/lib/email/forward";
import { MAX_TOTAL_ATTACHMENT_SIZE } from "@/lib/email/limits";

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

describe("buildDefaultSignature", () => {
	it("puts the logo first, then the sender's name, details and social links", () => {
		const signature = buildDefaultSignature({
			name: "Rukia <Ali>",
			fromAddr: "CaliberCode <contact@calibercode.io>",
		});
		expect(signature).not.toBeNull();
		const html = signature?.html ?? "";
		const positions = [
			"sig.default-logo",
			"Rukia &lt;Ali&gt;",
			"+254 733 313 314",
			"contact@calibercode.io",
			"1st Floor #113",
			"sig.default-facebook",
			"sig.default-linkedin",
			"sig.default-instagram",
		].map((part) => html.indexOf(part));
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
		expect(signature?.attachments.map((file) => file.disposition)).toEqual(
			Array.from({ length: 4 }, () => "inline"),
		);
		expect(signature?.text.startsWith("Rukia <Ali>\n")).toBe(true);
	});

	it("only applies to CaliberCode addresses", () => {
		expect(buildDefaultSignature({ name: "A", fromAddr: "a@example.com" })).toBeNull();
	});
});
