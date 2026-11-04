import { describe, expect, it } from "vitest";
import { attachmentLimitError, validateMessageBudget } from "@/lib/email/limits";
import { detectPreviewType, parseByteRange, previewKind } from "@/lib/email/preview";
import { readFormDataBody } from "@/lib/http/request";
import { parseSendRequest } from "@/app/api/send/utils";
import { getSecurityHeaders } from "@/lib/security/headers";

describe("attachment budget and preview contracts", () => {
	it("enforces final message overhead and signature assets beyond the selected-file budget", () => {
		expect(attachmentLimitError([{ size: 3 * 1024 * 1024 + 1 }])).toContain("3 MiB");
		expect(() =>
			validateMessageBudget({ text: "body" }, [{ size: 3 * 1024 * 1024 }]),
		).not.toThrow();
		expect(() =>
			validateMessageBudget({ html: "x".repeat(500000) }, [{ size: 3 * 1024 * 1024 }]),
		).toThrow("5 MiB");
		expect(() => validateMessageBudget({}, [{ size: 4 * 1024 * 1024 }])).toThrow("5 MiB");
		expect(attachmentLimitError(Array.from({ length: 11 }, () => ({ size: 1 })))).toContain(
			"10 attachments",
		);
	});
	it("roundtrips multipart file bytes/names and retains empty supported files", async () => {
		const form = new FormData();
		form.set("from", "sender@example.test");
		form.append(
			"attachments",
			new File([new Uint8Array([0, 255, 21])], "réport.pdf", { type: "application/pdf" }),
		);
		form.append("attachments", new File([], "empty.txt", { type: "text/plain" }));
		const parsed = await parseSendRequest(
			new Request("https://example.test/api/send", { method: "POST", body: form }),
		);
		expect(parsed.attachments?.map((file) => file.filename)).toEqual(["réport.pdf", "empty.txt"]);
		expect(new Uint8Array(parsed.attachments![0].content)).toEqual(new Uint8Array([0, 255, 21]));
		expect(parsed.attachments![1].content.byteLength).toBe(0);
	});
	it("rejects chunked request overflow before buffering the rest", async () => {
		let canceled = false;
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(25));
			},
			cancel() {
				canceled = true;
			},
		});
		const request = new Request("https://example.test/send", {
			method: "POST",
			headers: { "Content-Type": "multipart/form-data; boundary=x" },
			body: stream,
			duplex: "half",
		} as RequestInit);
		await expect(readFormDataBody(request, 20)).rejects.toThrow("too large");
		expect(canceled).toBe(true);
	});
	it("detects safe file content, normalizes MIME parameters and keeps HTML/SVG download-only", () => {
		const bytes = (value: string) => new TextEncoder().encode(value);
		expect(detectPreviewType(bytes("%PDF-1.7"), "application/octet-stream")).toBe(
			"application/pdf",
		);
		expect(detectPreviewType(bytes("<svg><script>bad()</script></svg>"), "image/png")).toBe(
			"application/octet-stream",
		);
		expect(detectPreviewType(bytes("fake PDF"), "application/pdf")).toBe(
			"application/octet-stream",
		);
		expect(previewKind("Application/PDF; version=1.7")).toBe("pdf");
		expect(previewKind("text/html")).toBe("unsupported");
		expect(detectPreviewType(new Uint8Array(), "text/plain")).toBe("text/plain");
		expect(
			detectPreviewType(bytes("BEGIN:VCALENDAR\r\nVERSION:2.0"), "application/octet-stream"),
		).toBe("text/calendar");
	});
	it("parses closed, open and suffix ranges and signals unsatisfiable ranges", () => {
		expect(parseByteRange("bytes=2-5", 10)).toEqual({ offset: 2, length: 4 });
		expect(parseByteRange("bytes=2-", 10)).toEqual({ offset: 2, length: 8 });
		expect(parseByteRange("bytes=-3", 10)).toEqual({ offset: 7, length: 3 });
		expect(parseByteRange("bytes=10-", 10)).toBe("invalid");
		expect(parseByteRange("bytes=0-1,3-4", 10)).toBe("invalid");
		expect(parseByteRange("bytes=0-", 0)).toBe("invalid");
	});
	it("allows authenticated PDFs and local media under the app CSP", () => {
		const policy = getSecurityHeaders("production").find(
			(header) => header.key === "Content-Security-Policy",
		)!.value;
		expect(policy).toContain("frame-src 'self' blob: https://challenges.cloudflare.com");
		expect(policy).toContain("media-src 'self' blob:");
		expect(policy).toContain("object-src 'none'");
	});
});
