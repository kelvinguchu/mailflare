import type { AttachmentContent } from "./attachment-types";

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
