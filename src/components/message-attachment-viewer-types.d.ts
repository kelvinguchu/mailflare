import type { MessageAttachment } from "@/app/(dashboard)/inbox/[messageId]/types";

export interface MessageAttachmentViewerProps {
	attachment: MessageAttachment | null;
	messageId: string;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	localFile?: File;
	inspection?: boolean;
	proposedAttendees?: string[];
}

export type AttachmentPreviewKind = "audio" | "image" | "pdf" | "text" | "unsupported" | "video";
