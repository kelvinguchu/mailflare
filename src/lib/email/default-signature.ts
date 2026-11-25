import type { AttachmentContent } from "./attachment-types";
import { getEmailAddress } from "./address";
import {
	DEFAULT_SIGNATURE_FACEBOOK,
	DEFAULT_SIGNATURE_INSTAGRAM,
	DEFAULT_SIGNATURE_LINKEDIN,
	DEFAULT_SIGNATURE_LOGO,
} from "./default-signature-assets";

/**
 * CaliberCode's house signature, used by any calibercode.io mailbox that has not saved its own:
 * the logo, the sender's name, the firm's contact details, then the social links in one row.
 *
 * Mail apps ignore stylesheets and classes, so the layout is nested tables with inline styles
 * only. Every image sits in its own table cell as a block, which keeps the icons side by side
 * even where a client (or Mailflare's own viewer) makes images block level. The images travel
 * as inline parts with a Content-ID, so they show without loading remote content and are not
 * listed as attachments.
 */

const DEFAULT_SIGNATURE_DOMAIN = "calibercode.io";

const FONT_FAMILY = "Arial, Helvetica, sans-serif";
const NAVY = "#10386e";
const TEXT_COLOR = "#374151";

/** Shown at 160px from a 376px image, so it stays sharp at 2x. Height follows the width. */
const LOGO = {
	filename: "calibercode-logo.png",
	contentId: "sig.default-logo@ccmail.local",
	width: 160,
	png: DEFAULT_SIGNATURE_LOGO,
};

/** Shown at 24px from 48px images. */
const ICON_SIZE = 24;
const ICON_GAP = 8;

const CONTACT_LINES: Array<{ label: string; value: string; href: string }> = [
	{ label: "Phone", value: "+254 733 313 314", href: "tel:+254733313314" },
	{ label: "Mobile", value: "+254 753 033 333", href: "tel:+254753033333" },
	{ label: "WhatsApp", value: "+254 780 333 331", href: "https://wa.me/254780333331" },
	{ label: "Email", value: "contact@calibercode.io", href: "mailto:contact@calibercode.io" },
];

const ADDRESS_LINES = [
	"Wabera Str, Jubilee Insurance Hse,",
	"1st Floor #113, 100010-00101 Nairobi",
];

const SOCIAL_LINKS: Array<{
	label: string;
	href: string;
	filename: string;
	contentId: string;
	png: string;
}> = [
	{
		label: "Facebook",
		href: "https://web.facebook.com/calibercode/",
		filename: "facebook.png",
		contentId: "sig.default-facebook@ccmail.local",
		png: DEFAULT_SIGNATURE_FACEBOOK,
	},
	{
		label: "LinkedIn",
		href: "https://www.linkedin.com/company/calibercodeltd/",
		filename: "linkedin.png",
		contentId: "sig.default-linkedin@ccmail.local",
		png: DEFAULT_SIGNATURE_LINKEDIN,
	},
	{
		label: "Instagram",
		href: "https://www.instagram.com/calibercode/",
		filename: "instagram.png",
		contentId: "sig.default-instagram@ccmail.local",
		png: DEFAULT_SIGNATURE_INSTAGRAM,
	},
];

const TABLE_ATTRIBUTES = `role="presentation" cellpadding="0" cellspacing="0" border="0"`;
const TABLE_STYLE = "border-collapse: collapse";
const TEXT_CELL_STYLE = `padding: 0; font-family: ${FONT_FAMILY}; font-size: 13px; line-height: 20px; color: ${TEXT_COLOR}`;
const LINK_STYLE = `color: ${TEXT_COLOR}; text-decoration: none`;

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

function row(cellStyle: string, content: string): string {
	return `<tr><td style="${cellStyle}">${content}</td></tr>`;
}

function socialRow(): string {
	const cells = SOCIAL_LINKS.map(({ label, href, contentId }, index) => {
		const padding = index === SOCIAL_LINKS.length - 1 ? "0" : `0 ${ICON_GAP}px 0 0`;
		const image = `<img src="cid:${contentId}" width="${ICON_SIZE}" height="${ICON_SIZE}" alt="${label}" style="display: block; width: ${ICON_SIZE}px; height: ${ICON_SIZE}px; border: 0">`;
		return `<td style="padding: ${padding}; vertical-align: middle"><a href="${href}" style="text-decoration: none">${image}</a></td>`;
	}).join("");
	return `<table ${TABLE_ATTRIBUTES} style="${TABLE_STYLE}"><tbody><tr>${cells}</tr></tbody></table>`;
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

	const rows = [
		row(
			"padding: 0 0 12px 0",
			`<img src="cid:${LOGO.contentId}" width="${LOGO.width}" alt="CaliberCode" style="display: block; width: ${LOGO.width}px; height: auto; border: 0">`,
		),
		name
			? row(
					`padding: 0 0 6px 0; font-family: ${FONT_FAMILY}; font-size: 15px; line-height: 20px; font-weight: bold; color: ${NAVY}`,
					escapeHtml(name),
				)
			: "",
		...CONTACT_LINES.map(({ label, value, href }) =>
			row(TEXT_CELL_STYLE, `${label}: <a href="${href}" style="${LINK_STYLE}">${value}</a>`),
		),
		...ADDRESS_LINES.map((line) => row(TEXT_CELL_STYLE, escapeHtml(line))),
		row("padding: 12px 0 0 0", socialRow()),
	];
	const html = `<table ${TABLE_ATTRIBUTES} style="${TABLE_STYLE}"><tbody>${rows.join("")}</tbody></table>`;

	const text = [
		...(name ? [name] : []),
		"CaliberCode",
		"",
		...CONTACT_LINES.map(({ label, value }) => `${label}: ${value}`),
		...ADDRESS_LINES,
		"",
		...SOCIAL_LINKS.map(({ label, href }) => `${label}: ${href}`),
	].join("\n");

	return {
		html,
		text,
		attachments: [
			inlinePng(LOGO.filename, LOGO.contentId, LOGO.png),
			...SOCIAL_LINKS.map(({ filename, contentId, png }) => inlinePng(filename, contentId, png)),
		],
	};
}
