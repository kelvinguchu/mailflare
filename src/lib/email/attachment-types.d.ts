export interface AttachmentContent {
	content: ArrayBuffer;
	contentId?: string | null;
	disposition?: "attachment" | "inline";
	filename: string;
	type: string;
}

export interface AttachmentMetadata {
	contentId: string | null;
	disposition: "attachment" | "inline";
	filename: string;
	id: string;
	messageId: string;
	size: number;
	type: string;
	securityStatus: "safe" | "quarantined";
	securityReason: string | null;
}

export interface StoredAttachment extends AttachmentMetadata {
	r2Key: string;
}
