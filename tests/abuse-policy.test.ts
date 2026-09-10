import { describe, expect, it } from "vitest";
import { classifyAttachment } from "../src/lib/email/attachment-security";
import { scoreSpamHeaders } from "../src/lib/email/spam-score";

describe("inbound abuse policy", () => {
	it("quarantines executable extensions even when MIME is generic", () => {
		expect(classifyAttachment({ filename: "invoice.pdf.exe", type: "application/octet-stream" })).toEqual({
			status: "quarantined",
			reason: "Executable attachment type",
		});
	});

	it("keeps ordinary document attachments available", () => {
		expect(classifyAttachment({ filename: "invoice.pdf", type: "application/pdf" }).status).toBe("safe");
	});

	it("scores upstream spam and authentication failures case-insensitively", () => {
		const result = scoreSpamHeaders({
			"X-Spam-Status": "Yes, score=8",
			"Authentication-Results": "mx.test; spf=fail; dkim=fail; dmarc=fail",
		});
		expect(result.score).toBe(17);
		expect(result.reasons).toContain("DMARC failed");
	});
});
