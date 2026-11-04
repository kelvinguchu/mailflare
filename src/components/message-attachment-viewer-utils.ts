import type { MessageAttachment } from "@/app/(dashboard)/inbox/[messageId]/types";
import type { AttachmentPreviewKind } from "./message-attachment-viewer-types";
import { previewKind } from "@/lib/email/preview";

export function getAttachmentFileUrl(
	messageId: string,
	attachmentId: string,
	mode: "download" | "preview" = "download",
	inspection = false,
): string {
	const suffix = mode === "preview" ? "?preview=1" : "?download=1";
	return `/api/${inspection ? "team-inboxes/messages" : "messages"}/${messageId}/attachments/${attachmentId}${suffix}`;
}

export function getAttachmentPreviewKind(
	attachment: Pick<MessageAttachment, "type">,
): AttachmentPreviewKind {
	return previewKind(attachment.type);
}
