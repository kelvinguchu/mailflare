"use client";

import { createElement, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	Archive,
	ArrowLeft,
	Ban,
	BellOff,
	FolderInput,
	Mail,
	MailOpen,
	MoreVertical,
	ShieldAlert,
	Trash2,
} from "lucide-react";
import { MoveToFolderDialog } from "@/components/messages/move-to-folder-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import type { BulkMessageAction } from "@/app/api/messages/bulk/types";
import { cn } from "@/lib/utils";
import type { MessageActionsProps } from "./types";
import {
	blockMessageContact,
	confirmTrashWithoutUnsubscribe,
	createTrashSenderRule,
	getMessageActionRedirect,
	getMessageBackHref,
	getMoveMessageActions,
	openUnsubscribeUrl,
	runSingleMessageAction,
} from "./utils";

/** Actions that take the conversation out of view send the reader back to the list, as in Gmail. */
const LEAVES_VIEW: ReadonlySet<BulkMessageAction> = new Set([
	"archive",
	"spam",
	"trash",
	"inbox",
	"unread",
]);

function ToolbarButton({
	label,
	disabled,
	onClick,
	children,
}: Readonly<{
	label: string;
	disabled?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}>) {
	return (
		<Tooltip label={label}>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				aria-label={label}
				disabled={disabled}
				onClick={onClick}
				className="rounded-full text-neutral-600"
			>
				{children}
			</Button>
		</Tooltip>
	);
}

function Divider() {
	return <span aria-hidden="true" className="mx-1 h-4 w-px bg-neutral-200" />;
}

export function MessageActions({
	messageId,
	mailboxId,
	senderAddress,
	direction,
	status,
	read,
	unsubscribeUrl,
	backHref,
}: MessageActionsProps) {
	const router = useRouter();
	const [pendingAction, setPendingAction] = useState<
		BulkMessageAction | "unsubscribe" | "block" | null
	>(null);
	const [error, setError] = useState<string | null>(null);
	const [folderDialogOpen, setFolderDialogOpen] = useState(false);
	const listHref = backHref ?? getMessageBackHref(direction, status);

	async function runAction(action: BulkMessageAction) {
		setPendingAction(action);
		setError(null);
		try {
			await runSingleMessageAction(messageId, action);
			const redirect = LEAVES_VIEW.has(action)
				? (backHref ?? getMessageActionRedirect(action, direction))
				: null;
			if (redirect) router.push(redirect);
			router.refresh();
		} catch {
			setError("Couldn’t update this conversation");
		} finally {
			setPendingAction(null);
		}
	}

	async function moveToFolder(folderId: string) {
		await runSingleMessageAction(messageId, "folder", "thread", folderId);
		router.push(backHref ?? `/folders/${folderId}`);
		router.refresh();
	}

	async function onUnsubscribe() {
		setError(null);
		if (unsubscribeUrl) {
			openUnsubscribeUrl(unsubscribeUrl);
			return;
		}
		if (!confirmTrashWithoutUnsubscribe()) return;
		if (!mailboxId) {
			setError("Couldn’t create the trash rule");
			return;
		}
		setPendingAction("unsubscribe");
		try {
			await createTrashSenderRule({ mailboxId, senderAddress });
			await runAction("trash");
		} catch {
			setError("Couldn’t create the trash rule");
			setPendingAction(null);
		}
	}

	async function onBlockContact() {
		setError(null);
		if (!mailboxId) {
			setError("Couldn’t block this contact");
			return;
		}
		setPendingAction("block");
		try {
			await blockMessageContact({ mailboxId, senderAddress });
			await runSingleMessageAction(messageId, "trash", "message");
			router.push(backHref ?? "/trash");
			router.refresh();
		} catch (blockError) {
			setError(blockError instanceof Error ? blockError.message : "Couldn’t block this contact");
		} finally {
			setPendingAction(null);
		}
	}

	const disabled = pendingAction !== null;
	const inbound = direction === "inbound";
	const otherMoves = getMoveMessageActions(status, direction).filter(
		(item) => item.action === "inbox",
	);

	return (
		<div className="flex min-w-0 items-center">
			<Tooltip label="Back">
				<Link
					href={listHref}
					aria-label="Back"
					className={cn(
						buttonVariants({ variant: "ghost", size: "icon-sm" }),
						"rounded-full text-neutral-600",
					)}
				>
					<ArrowLeft className="size-4" />
				</Link>
			</Tooltip>
			<Divider />
			<ToolbarButton
				label="Archive"
				disabled={disabled || status === "archived"}
				onClick={() => void runAction("archive")}
			>
				<Archive className="size-4" />
			</ToolbarButton>
			<ToolbarButton
				label="Report spam"
				disabled={disabled || status === "spam" || !inbound}
				onClick={() => void runAction("spam")}
			>
				<ShieldAlert className="size-4" />
			</ToolbarButton>
			<ToolbarButton
				label="Delete"
				disabled={disabled || status === "trash"}
				onClick={() => void runAction("trash")}
			>
				<Trash2 className="size-4" />
			</ToolbarButton>
			<Divider />
			<ToolbarButton
				label={read ? "Mark as unread" : "Mark as read"}
				disabled={disabled}
				onClick={() => void runAction(read ? "unread" : "read")}
			>
				{read ? <Mail className="size-4" /> : <MailOpen className="size-4" />}
			</ToolbarButton>
			{mailboxId && (
				<ToolbarButton
					label="Move to folder"
					disabled={disabled}
					onClick={() => setFolderDialogOpen(true)}
				>
					<FolderInput className="size-4" />
				</ToolbarButton>
			)}
			<DropdownMenu>
				<DropdownMenuTrigger
					disabled={disabled}
					aria-label="More actions"
					render={
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="rounded-full text-neutral-600"
						/>
					}
				>
					<MoreVertical className="size-4" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-52">
					{otherMoves.map((item) => (
						<DropdownMenuItem key={item.action} onClick={() => void runAction(item.action)}>
							{createElement(item.icon, { className: "size-4" })}
							Move to {item.label}
						</DropdownMenuItem>
					))}
					{inbound && (
						<>
							{otherMoves.length > 0 && <DropdownMenuSeparator />}
							<DropdownMenuItem
								disabled={!unsubscribeUrl && status === "trash"}
								onClick={() => void onUnsubscribe()}
							>
								<BellOff className="size-4" />
								Unsubscribe
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => void onBlockContact()}>
								<Ban className="size-4" />
								Block sender
							</DropdownMenuItem>
						</>
					)}
					{!inbound && otherMoves.length === 0 && (
						<DropdownMenuLabel className="font-normal">No more actions</DropdownMenuLabel>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{error && (
				<span role="alert" className="ml-2 truncate text-xs text-red-600">
					{error}
				</span>
			)}
			<MoveToFolderDialog
				open={folderDialogOpen}
				onOpenChange={setFolderDialogOpen}
				mailboxId={mailboxId}
				onMove={(folder) => moveToFolder(folder.id)}
			/>
		</div>
	);
}
