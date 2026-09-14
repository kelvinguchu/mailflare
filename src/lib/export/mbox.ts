import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { parseStoredReferences } from "@/lib/email/threading";

function escapeHeader(value: string | null): string {
	return (value ?? "").replace(/\r?\n/g, " ").trim();
}

function escapeMboxBody(value: string): string {
	return value.replace(/\nFrom /g, "\n>From ");
}

function getMboxFromLine(date: Date): string {
	return `From MAILER-DAEMON ${date.toUTCString()}`;
}

export async function exportMailboxToMbox(env: CloudflareEnv, mailboxId: string): Promise<string> {
	const db = getDb(env);
	const rows = await db
		.select({
			id: messages.id,
			fromAddr: messages.fromAddr,
			toAddr: messages.toAddr,
			subject: messages.subject,
			providerMessageId: messages.providerMessageId,
			inReplyTo: messages.inReplyTo,
			references: messages.references,
			direction: messages.direction,
			status: messages.status,
			createdAt: messages.createdAt,
			textBody: messages.textBody,
			htmlBody: messages.htmlBody,
		})
		.from(messages)
		.where(eq(messages.mailboxId, mailboxId))
		.orderBy(asc(messages.createdAt));

	return rows
		.map((message) => {
			const date = new Date(message.createdAt);
			const body = message.htmlBody ?? message.textBody ?? "";
			const contentType = message.htmlBody ? "text/html" : "text/plain";
			const references = parseStoredReferences(message.references);
			return [
				getMboxFromLine(date),
				`Message-ID: ${escapeHeader(message.providerMessageId || `<${message.id}@mailflare.local>`)}`,
				`Date: ${date.toUTCString()}`,
				`From: ${escapeHeader(message.fromAddr)}`,
				`To: ${escapeHeader(message.toAddr)}`,
				`Subject: ${escapeHeader(message.subject)}`,
				...(message.inReplyTo ? [`In-Reply-To: ${escapeHeader(message.inReplyTo)}`] : []),
				...(references.length > 0 ? [`References: ${escapeHeader(references.join(" "))}`] : []),
				`X-Mailflare-Direction: ${escapeHeader(message.direction)}`,
				`X-Mailflare-Status: ${escapeHeader(message.status)}`,
				"MIME-Version: 1.0",
				`Content-Type: ${contentType}; charset=utf-8`,
				"Content-Transfer-Encoding: 8bit",
				"",
				escapeMboxBody(body),
				"",
			].join("\r\n");
		})
		.join("\r\n");
}
