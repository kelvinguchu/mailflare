import { describe, expect, it } from "vitest";
import { extractSignatureContentIds, sanitizeMailboxSignature } from "@/lib/email/signatures";
import { inspectSignatureImage } from "@/lib/email/signature-assets";

describe("mailbox signature sanitization", () => {
	it("keeps email-safe formatting and registered CID-shaped images", () => {
		const signature = sanitizeMailboxSignature({
			html: `<p style="color: #123456; background-image: url(https://tracker.test/x)">
				<strong>Alex &amp; Co</strong><br>
				<a href="https://example.test" onclick="steal()">Website</a>
				<img src="cid:sig.sigimg_logo@ccmail.local" alt="Company logo" onerror="steal()">
			</p>`,
		});

		expect(signature.html).toContain("<strong>Alex &amp; Co</strong>");
		expect(signature.html).toContain('href="https://example.test"');
		expect(signature.html).toContain('src="cid:sig.sigimg_logo@ccmail.local"');
		expect(signature.html).not.toContain("onclick");
		expect(signature.html).not.toContain("onerror");
		expect(signature.html).not.toContain("background-image");
		expect(signature.text).toBe("Alex & Co\nWebsite");
		expect(signature.contentIds).toEqual(["sig.sigimg_logo@ccmail.local"]);
	});

	it("drops scripts, remote images, data images, and unsafe links", () => {
		const signature = sanitizeMailboxSignature({
			html: `<script>alert(1)</script><a href="javascript:alert(1)">Bad</a>
			<img src="https://tracker.test/pixel.png"><img src="data:image/png;base64,AAAA">`,
		});

		expect(signature.html).not.toContain("script");
		expect(signature.html).not.toContain("javascript:");
		expect(signature.html).not.toContain("tracker.test");
		expect(signature.html).not.toContain("data:image");
		expect(signature.contentIds).toEqual([]);
	});

	it("uses explicitly supplied plain text as the fallback", () => {
		const signature = sanitizeMailboxSignature({
			html: "<p><strong>Visual version</strong></p>",
			text: "Accessible version",
		});
		expect(signature.text).toBe("Accessible version");
	});

	it("deduplicates repeated content IDs", () => {
		const html = `<img src="cid:sig.sigimg_logo@ccmail.local"><img src="cid:sig.sigimg_logo@ccmail.local">`;
		expect(extractSignatureContentIds(html)).toEqual(["sig.sigimg_logo@ccmail.local"]);
	});
});

describe("signature image inspection", () => {
	it("reads PNG dimensions from verified PNG content", () => {
		const bytes = new Uint8Array(24);
		bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const view = new DataView(bytes.buffer);
		view.setUint32(16, 320);
		view.setUint32(20, 80);
		expect(inspectSignatureImage(bytes.buffer, "image/png")).toEqual({ width: 320, height: 80 });
	});

	it("rejects content that does not match the declared image type", () => {
		expect(() => inspectSignatureImage(new Uint8Array([1, 2, 3]).buffer, "image/png")).toThrow(
			"does not match",
		);
	});

	it("rejects oversized dimensions", () => {
		const bytes = new Uint8Array(24);
		bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const view = new DataView(bytes.buffer);
		view.setUint32(16, 1_201);
		view.setUint32(20, 80);
		expect(() => inspectSignatureImage(bytes.buffer, "image/png")).toThrow("cannot exceed");
	});
});
