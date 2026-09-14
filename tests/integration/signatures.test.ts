import { beforeEach, describe, expect, it } from "vitest";
import { storeSignatureAsset } from "@/lib/email/signature-assets";
import {
	assertSignatureAssetsBelongToMailbox,
	renderMailboxSignatureForSend,
} from "@/lib/email/signatures";
import { fixtureIds, resetIntegrationState, seedMailboxWorld } from "./fixtures";
import { integrationEnv } from "./bindings";

beforeEach(async () => {
	await resetIntegrationState();
	await seedMailboxWorld();
});

describe("rich mailbox signature persistence", () => {
	it("loads CID images and renders both MIME body alternatives", async () => {
		const image = createPngHeader(240, 60);
		const asset = await storeSignatureAsset(integrationEnv, {
			mailboxId: fixtureIds.sharedMailbox,
			uploadedByUserId: fixtureIds.owner,
			filename: "logo.png",
			type: "image/png",
			content: image,
			altText: "Company logo",
		});
		await integrationEnv.DB.prepare(
			`UPDATE mailboxes
			 SET signature = ?, signature_text = ?, signature_html = ?, signature_version = 2
			 WHERE id = ?`,
		)
			.bind(
				"Alex\nExample Company",
				"Alex\nExample Company",
				`<p><strong>Alex</strong><br>Example Company</p><img src="${asset.src}" alt="Company logo">`,
				fixtureIds.sharedMailbox,
			)
			.run();

		const rendered = await renderMailboxSignatureForSend(integrationEnv, fixtureIds.sharedMailbox, {
			text: "Hello",
		});

		expect(rendered.text).toBe("Hello\n\nAlex\nExample Company");
		expect(rendered.html).toContain('data-ccmail-signature="2"');
		expect(rendered.html).toContain(`src="${asset.src}"`);
		expect(rendered.attachments).toHaveLength(1);
		expect(rendered.attachments[0]).toMatchObject({
			contentId: asset.contentId,
			disposition: "inline",
			filename: "logo.png",
			type: "image/png",
		});
		expect(rendered.attachments[0]?.content.byteLength).toBe(image.byteLength);
	});

	it("rejects a signature image owned by a different mailbox", async () => {
		await expect(
			assertSignatureAssetsBelongToMailbox(integrationEnv, fixtureIds.localMailbox, [
				"sig.sigimg_missing@ccmail.local",
			]),
		).rejects.toThrow("does not belong");
	});

	it("still produces both MIME alternatives when the mailbox has no signature", async () => {
		const rendered = await renderMailboxSignatureForSend(integrationEnv, fixtureIds.sharedMailbox, {
			html: "<p>Hello <strong>there</strong></p>",
		});
		expect(rendered.html).toBe("<p>Hello <strong>there</strong></p>");
		expect(rendered.text).toBe("Hello there");
		expect(rendered.attachments).toEqual([]);
	});
});

function createPngHeader(width: number, height: number): ArrayBuffer {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const view = new DataView(bytes.buffer);
	view.setUint32(16, width);
	view.setUint32(20, height);
	return bytes.buffer;
}
