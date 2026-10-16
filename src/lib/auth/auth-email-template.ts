export type AuthEmailPurpose =
	"password_reset" | "recovery_email_verification" | "account_activation";

export type AuthEmailInput = {
	purpose: AuthEmailPurpose;
	link: string;
	origin: string;
	accountEmail: string;
	recipient: string;
};

export type RenderedAuthEmail = {
	subject: string;
	text: string;
	html: string;
};

const BRAND = {
	navy: "#194270",
	navyDeep: "#12325a",
	orange: "#ee8321",
	ink: "#1f2937",
	muted: "#5b6576",
	faint: "#8a93a3",
	line: "#e6e9ef",
	canvas: "#f2f4f8",
};

const FONT_STACK =
	"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const CONTENT: Record<
	AuthEmailPurpose,
	{
		subject: string;
		eyebrow: string;
		heading: string;
		intro: (account: string) => string;
		action: string;
		expiry: string;
		footnote: string;
	}
> = {
	password_reset: {
		subject: "Reset your CC Mail password",
		eyebrow: "Password reset",
		heading: "Reset your password",
		intro: (account) =>
			`We received a request to reset the password for ${account}. Choose a new password with the button below.`,
		action: "Reset password",
		expiry: "30 minutes",
		footnote:
			"If you didn't ask for this, you can ignore this email and your password will stay the same. Resetting your password signs you out on every device.",
	},
	recovery_email_verification: {
		subject: "Verify your CC Mail recovery email",
		eyebrow: "Recovery email",
		heading: "Confirm your recovery email",
		intro: (account) =>
			`Confirm that this address can be used to recover ${account} if you ever lose access to it.`,
		action: "Verify email",
		expiry: "24 hours",
		footnote:
			"If you didn't add this address to a CC Mail account, you can ignore this email and nothing will change.",
	},
	account_activation: {
		subject: "Activate your CC Mail account",
		eyebrow: "Welcome to CC Mail",
		heading: "Your mailbox is ready",
		intro: (account) =>
			`An account has been created for ${account}. Set a password to activate it and start using CC Mail.`,
		action: "Activate account",
		expiry: "72 hours",
		footnote: "If you weren't expecting this invitation, you can ignore this email.",
	},
};

export function renderAuthEmail(input: AuthEmailInput): RenderedAuthEmail {
	const content = CONTENT[input.purpose];
	const host = new URL(input.origin).host;
	const logoUrl = new URL("/email/calibercode-logo.png", input.origin).toString();
	const preheader = `${content.action}. This link expires in ${content.expiry}.`;

	const text = [
		content.heading,
		"",
		content.intro(input.accountEmail),
		"",
		`${content.action}: ${input.link}`,
		"",
		`This link expires in ${content.expiry} and can only be used once.`,
		"",
		content.footnote,
		"",
		"--",
		`CC Mail by CaliberCode · ${host}`,
		`Sent to ${input.recipient}, the recovery address for ${input.accountEmail}.`,
	].join("\n");

	const link = escapeHtml(input.link);
	const account = `<strong style="color:${BRAND.ink};font-weight:600;">${escapeHtml(input.accountEmail)}</strong>`;

	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(content.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.canvas};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.canvas};">
<tr>
<td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr>
<td style="background-color:${BRAND.navy};border-radius:14px 14px 0 0;padding:26px 36px;">
<img src="${escapeHtml(logoUrl)}" width="180" height="36" alt="CaliberCode" style="display:block;border:0;outline:none;text-decoration:none;width:180px;height:36px;">
</td>
</tr>
<tr>
<td style="background-color:${BRAND.orange};height:4px;line-height:4px;font-size:0;">&nbsp;</td>
</tr>
<tr>
<td style="background-color:#ffffff;border-radius:0 0 14px 14px;padding:36px 36px 32px;font-family:${FONT_STACK};">
<p style="margin:0 0 10px;font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${BRAND.orange};">${escapeHtml(content.eyebrow)}</p>
<h1 style="margin:0 0 16px;font-size:24px;line-height:32px;font-weight:700;color:${BRAND.navyDeep};">${escapeHtml(content.heading)}</h1>
<p style="margin:0 0 28px;font-size:16px;line-height:26px;color:${BRAND.muted};">${content.intro(account)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td align="center" bgcolor="${BRAND.navy}" style="border-radius:10px;background-color:${BRAND.navy};">
<a href="${link}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT_STACK};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(content.action)}</a>
</td>
</tr>
</table>
<p style="margin:20px 0 0;font-size:14px;line-height:22px;color:${BRAND.muted};">This link expires in <strong style="color:${BRAND.ink};font-weight:600;">${escapeHtml(content.expiry)}</strong> and can only be used once.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 24px;">
<tr><td style="border-top:1px solid ${BRAND.line};height:1px;line-height:1px;font-size:0;">&nbsp;</td></tr>
</table>
<p style="margin:0 0 8px;font-size:13px;line-height:20px;color:${BRAND.faint};">Button not working? Paste this link into your browser:</p>
<p style="margin:0 0 20px;font-size:13px;line-height:20px;word-break:break-all;"><a href="${link}" target="_blank" style="color:${BRAND.navy};text-decoration:underline;">${link}</a></p>
<p style="margin:0;font-size:13px;line-height:20px;color:${BRAND.faint};">${escapeHtml(content.footnote)}</p>
</td>
</tr>
<tr>
<td align="center" style="padding:24px 24px 0;font-family:${FONT_STACK};font-size:12px;line-height:18px;color:${BRAND.faint};">
<p style="margin:0 0 4px;"><span style="color:${BRAND.navy};font-weight:600;">CC Mail</span> by CaliberCode · <a href="${escapeHtml(input.origin)}" target="_blank" style="color:${BRAND.faint};text-decoration:underline;">${escapeHtml(host)}</a></p>
<p style="margin:0;">Sent to ${escapeHtml(input.recipient)}, the recovery address for ${escapeHtml(input.accountEmail)}.</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;

	return { subject: content.subject, text, html };
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
