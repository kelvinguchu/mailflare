import { and, eq, isNull, or } from "drizzle-orm";
import type { getDb } from "@/db";
import { senderPolicies } from "@/db/schema";
import { getEmailAddress } from "@/lib/email/address";
import type { AttachmentContent } from "@/lib/email/attachment-types";
import { scoreSpamHeaders } from "@/lib/email/spam-score";

type Db = ReturnType<typeof getDb>;

const EXECUTABLE_EXTENSIONS = new Set([
	"apk", "app", "bat", "cmd", "com", "cpl", "dll", "dmg", "exe", "hta",
	"img", "iso", "jar", "js", "jse", "lnk", "msi", "msp", "ps1", "scr",
	"vbe", "vbs", "wsf",
]);

const EXECUTABLE_TYPES = new Set([
	"application/java-archive",
	"application/vnd.android.package-archive",
	"application/vnd.microsoft.portable-executable",
	"application/x-dosexec",
	"application/x-executable",
	"application/x-msdownload",
	"application/x-msi",
	"text/javascript",
]);

export type AttachmentSecurity = { status: "safe" | "quarantined"; reason: string | null };

export function classifyAttachment(attachment: Pick<AttachmentContent, "filename" | "type">): AttachmentSecurity {
	const extension = attachment.filename.toLowerCase().split(".").pop() ?? "";
	const contentType = attachment.type.toLowerCase().split(";", 1)[0]?.trim() ?? "";
	if (EXECUTABLE_EXTENSIONS.has(extension) || EXECUTABLE_TYPES.has(contentType)) {
		return { status: "quarantined", reason: "Executable attachment type" };
	}
	return { status: "safe", reason: null };
}

export async function getInboundSenderPolicy(db: Db, userId: string, from: string) {
	const address = getEmailAddress(from).toLowerCase();
	const domain = address.split("@")[1] ?? "";
	if (!address || !domain) return null;
	const rows = await db.select().from(senderPolicies).where(and(
		or(eq(senderPolicies.userId, userId), isNull(senderPolicies.userId)),
		or(
			and(eq(senderPolicies.patternType, "address"), eq(senderPolicies.pattern, address)),
			and(eq(senderPolicies.patternType, "domain"), eq(senderPolicies.pattern, domain)),
		),
	));
	return rows.sort((left, right) => {
		const rank = (row: typeof rows[number]) => (row.userId ? 4 : 0) + (row.patternType === "address" ? 2 : 0) + (row.action === "allow" ? 1 : 0);
		return rank(right) - rank(left);
	})[0] ?? null;
}

export async function assessInboundAbuse(
	db: Db,
	input: { userId: string; from: string; headers?: Record<string, string>; attachments: AttachmentContent[] },
) {
	const senderPolicy = await getInboundSenderPolicy(db, input.userId, input.from);
	const attachmentResults = input.attachments.map(classifyAttachment);
	const unsafeAttachment = attachmentResults.find((result) => result.status === "quarantined");
	const spam = scoreSpamHeaders(input.headers);
	const reasons = [...spam.reasons];
	if (senderPolicy?.action === "block") reasons.unshift("Sender matched a block policy");
	if (unsafeAttachment?.reason) reasons.unshift(unsafeAttachment.reason);
	const quarantined = !!unsafeAttachment || senderPolicy?.action === "block" || (senderPolicy?.action !== "allow" && spam.score >= 6);
	return {
		securityStatus: quarantined ? "quarantined" as const : spam.score > 0 ? "suspicious" as const : "clean" as const,
		securityReason: reasons.length > 0 ? reasons.join("; ").slice(0, 500) : null,
		spamScore: spam.score,
		attachmentResults,
	};
}
