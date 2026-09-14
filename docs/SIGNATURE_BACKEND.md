# Rich signature backend contract

CC Mail stores signatures per mailbox as a sanitized HTML representation and a plain-text
fallback. The legacy `signature` response field remains available and mirrors
`signatureText`.

## Mailbox signature

`GET /api/mailboxes/:mailboxId` and `GET /api/mailboxes` return:

```json
{
	"signature": "Alex\nExample Company",
	"signatureText": "Alex\nExample Company",
	"signatureHtml": "<p><strong>Alex</strong><br>Example Company</p>",
	"signatureVersion": 2
}
```

Update a rich signature with `PATCH /api/mailboxes/:mailboxId`:

```json
{
	"signatureText": "Alex\nExample Company",
	"signatureHtml": "<p><strong>Alex</strong><br>Example Company</p>"
}
```

The server sanitizes HTML, generates `signatureText` from HTML when it is omitted, verifies
that every CID image belongs to the mailbox, and increments `signatureVersion`. Sending the
legacy `{ "signature": "..." }` payload updates the plain-text signature and clears rich HTML.

Supported markup is intentionally limited to common email-safe text, lists, links, tables,
inline styles, and managed CID images. Scripts, forms, iframes, SVG, event handlers, remote
images, data URLs, unsafe links, and CSS URL/expression features are discarded.

## Signature images

Upload with `POST /api/mailboxes/:mailboxId/signature/assets` as multipart form data:

- `file`: JPEG, PNG, or GIF; maximum 512 KB and 1200 by 600 pixels.
- `altText`: optional, maximum 200 characters.

Each mailbox can hold at most five images and 2 MB total. The response contains:

```json
{
	"asset": {
		"id": "sigimg_...",
		"contentId": "sig.sigimg_...@ccmail.local",
		"src": "cid:sig.sigimg_...@ccmail.local",
		"previewUrl": "/api/mailboxes/mbx_.../signature/assets/sigimg_...",
		"filename": "logo.png",
		"type": "image/png",
		"size": 12345,
		"width": 240,
		"height": 60,
		"altText": "Company logo"
	}
}
```

Use the returned `src` exactly as the signature HTML image source. List images with
`GET /api/mailboxes/:mailboxId/signature/assets`, render an authenticated preview from the
returned `previewUrl`, and delete an unused image with
`DELETE /api/mailboxes/:mailboxId/signature/assets/:assetId`. An image referenced by the
current signature returns `409` until it is removed from the signature.

Reading requires mailbox read access. Upload, update, and delete require full mailbox access.

## Sending

Both `POST /api/send` and `POST /api/v1/send` accept:

```json
{
	"includeSignature": true
}
```

For multipart requests, send `includeSignature` as the string `"true"`. The default is
`false` for compatibility with the existing plain-text composer, which already inserts the
legacy signature client-side.

When enabled, the server:

1. Loads the latest signature after authorizing the sender mailbox.
2. Produces both HTML and plain-text MIME bodies.
3. Loads only referenced mailbox images from R2.
4. Copies those images into the queued message as inline CID attachments.
5. Stores the final message bodies and attachment snapshot before queue delivery.

This means later signature edits or asset deletion cannot change an email that is already
queued. A rich frontend should stop inserting signatures into body text itself and set
`includeSignature: true` to avoid duplicates.
