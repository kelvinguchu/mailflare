import type { AttachmentContent } from "./attachment-types";
import { getEmailAddress } from "./address";
import {
	DEFAULT_SIGNATURE_FACEBOOK,
	DEFAULT_SIGNATURE_INSTAGRAM,
	DEFAULT_SIGNATURE_LINKEDIN,
	DEFAULT_SIGNATURE_LOGO,
} from "./default-signature-assets";

/**
 * CaliberCode's house signature: used for any calibercode.io mailbox that has not
 * saved its own. The logo, the sender's name, the firm's contact details, then the
 * social links. Images travel inline, so they show without loading remote content.
 */

const DEFAULT_SIGNATURE_DOMAIN = "calibercode.io";

const CONTACT_LINES: Array<{ label: string; value: string; href: string }> = [
	{ label: "Phone", value: "+254 733 313 314", href: "tel:+254733313314" },
	{ label: "Mobile", value: "+254 753 033 333", href: "tel:+254753033333" },
	{ label: "WhatsApp", value: "+254 780 333 331", href: "https://wa.me/254780333331" },
	{ label: "Email", value: "contact@calibercode.io", href: "mailto:contact@calibercode.io" },
];

const ADDRESS_LINES = [
	"Wabera Str, Jubilee Insurance Hse,",
	"1st Floor #113, 100010-00101 Nairobi.",
];

const SOCIAL_LINKS: Array<{ label: string; href: string; contentId: string; png: string }> = [
	{
		label: "Facebook",
		href: "https://web.facebook.com/calibercode/",
		contentId: "sig.default-facebook@ccmail.local",
		png: DEFAULT_SIGNATURE_FACEBOOK,
	},
	{
		label: "LinkedIn",
		href: "https://www.linkedin.com/company/calibercodeltd/",
		contentId: "sig.default-linkedin@ccmail.local",
		png: DEFAULT_SIGNATURE_LINKEDIN,
	},
	{
		label: "Instagram",
		href: "https://www.instagram.com/calibercode/",
		contentId: "sig.default-instagram@ccmail.local",
		png: DEFAULT_SIGNATURE_INSTAGRAM,
	},
];

const LOGO_CONTENT_ID = "sig.default-logo@ccmail.local";
const TEXT_STYLE = "margin: 0; color: #374151; font-size: 13px; line-height: 1.5";

const escapeHtml = (value: string) =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");

function inlinePng(filename: string, contentId: string, base64: string): AttachmentContent {
	const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
	return {
		filename,
		type: "image/png",
		content: bytes.buffer,
		disposition: "inline",
		contentId,
	};
}

export type DefaultSignatureSender = { name: string; fromAddr: string };

export function buildDefaultSignature(sender: DefaultSignatureSender): {
	html: string;
	text: string;
	attachments: AttachmentContent[];
} | null {
	const address = getEmailAddress(sender.fromAddr).toLowerCase();
	if (!address.endsWith(`@${DEFAULT_SIGNATURE_DOMAIN}`)) return null;
	const name = sender.name.trim();

	const contact = CONTACT_LINES.map(
		({ label, value, href }) =>
			`<p style="${TEXT_STYLE}">${label}: <a href="${href}" style="color: #374151; text-decoration: none">${value}</a></p>`,
	).join("");
	const place = ADDRESS_LINES.map(
		(line) => `<p style="${TEXT_STYLE}">${escapeHtml(line)}</p>`,
	).join("");
	const social = SOCIAL_LINKS.map(
		({ label, href, contentId }) =>
			`<a href="${href}" style="text-decoration: none; margin-right: 8px"><img src="cid:${contentId}" width="24" height="24" alt="${label}" style="border: 0"></a>`,
	).join("");

	const html = [
		`<p style="margin: 0 0 10px"><img src="cid:${LOGO_CONTENT_ID}" width="150" height="90" alt="CaliberCode" style="border: 0"></p>`,
		name
			? `<p style="margin: 0 0 8px; color: #10386e; font-size: 14px; font-weight: bold">${escapeHtml(name)}</p>`
			: "",
		contact,
		place,
		`<p style="margin: 10px 0 0">${social}</p>`,
	].join("");

	const text = [
		...(name ? [name, ""] : []),
		...CONTACT_LINES.map(({ label, value }) => `${label}: ${value}`),
		...ADDRESS_LINES,
		"",
		SOCIAL_LINKS.map(({ label, href }) => `${label}: ${href}`).join("\n"),
	].join("\n");

	return {
		html,
		text,
		attachments: [
			inlinePng("calibercode-logo.png", LOGO_CONTENT_ID, DEFAULT_SIGNATURE_LOGO),
			...SOCIAL_LINKS.map(({ label, contentId, png }) =>
				inlinePng(`${label.toLowerCase()}.png`, contentId, png),
			),
		],
	};
}
