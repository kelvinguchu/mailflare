import type { BulkMessageAction } from "@/app/api/messages/bulk/types";
import type { MessageDirection } from "@/hooks/types";
import type { LucideIcon } from "lucide-react";

export type MessageActionsProps = {
	messageId: string;
	mailboxId: string | null;
	senderAddress: string;
	direction: MessageDirection;
	status: string;
	read: boolean;
	unsubscribeUrl?: string | null;
	/** Where Back, and actions that remove the conversation from view, return to. */
	backHref?: string;
};

export type SingleMessageAction = BulkMessageAction | "reply";

export type ReplyDraftInput = {
	/** The message being replied to, so the reply joins its conversation. */
	messageId: string;
	mailboxId: string | null;
	senderAddress: string;
	ownAddress?: string | null;
	subject?: string | null;
	bodyText?: string | null;
};

export type TrashSenderRuleInput = {
	mailboxId: string;
	senderAddress: string;
};

export type BlockMessageContactInput = {
	mailboxId: string;
	senderAddress: string;
};

export type MoveMessageActionItem = {
	action: BulkMessageAction;
	label: string;
	icon: LucideIcon;
};
