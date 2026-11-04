import type { AttachmentMetadata } from "@/lib/email/attachment-types";
export type TeamMailbox = {
	id: string;
	name: string | null;
	address: string;
	type: string;
	disabled: number;
	archivedAt: number | null;
	originalEmployeeEmail: string | null;
	currentOwnerEmail: string;
};
export type InspectionRow = {
	snippet: string | null;
	id: string;
	subject: string | null;
	mailboxId: string | null;
	mailboxAddress: string | null;
	employeeEmail: string | null;
	fromAddr: string;
	toAddr: string;
	createdAt: string;
	status: string;
	direction: string;
	read: boolean;
	employeeHiddenAt: string | null;
	hasDeletionHistory: boolean;
};
export type InspectionMessage = {
	message: import("@/hooks/types").Message & {
		id: string;
		subject: string | null;
		fromAddr: string;
		toAddr: string;
		ccAddr: string;
		createdAt: string;
		read: boolean;
		status: string;
		employeeHiddenAt: string | null;
		originalMailboxAddress: string | null;
		originalUserEmail: string | null;
		deletionOriginalStatus: string | null;
		deletionOriginalFolderName: string | null;
	};
	body: { htmlBody: string | null; textBody: string | null } | null;
	attachments: AttachmentMetadata[];
	history: { id: string; action: string; actorEmail: string | null; createdAt: string }[];
};
