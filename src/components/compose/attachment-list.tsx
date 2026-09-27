"use client";

import { FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ComposeAttachment } from "./types";
import { formatAttachmentSize } from "./utils";

export function AttachmentList({
	attachments,
	onRemove,
	className,
}: Readonly<{
	attachments: ComposeAttachment[];
	onRemove: (id: string) => void;
	className?: string;
}>) {
	if (attachments.length === 0) return null;
	return (
		<ul className={cn("flex flex-wrap gap-2", className)} aria-label="Attachments">
			{attachments.map((attachment) => (
				<li
					key={attachment.id}
					className="flex max-w-full items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 py-1.5 pr-1 pl-2.5 text-sm"
				>
					<FileText aria-hidden="true" className="size-4 shrink-0 text-neutral-500" />
					<span className="max-w-48 truncate">{attachment.file.name}</span>
					<span className="text-xs text-neutral-400">
						{formatAttachmentSize(attachment.file.size)}
					</span>
					<button
						type="button"
						onClick={() => onRemove(attachment.id)}
						className="rounded-full p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-primary/40"
						aria-label={`Remove ${attachment.file.name}`}
					>
						<X aria-hidden="true" className="size-3.5" />
					</button>
				</li>
			))}
		</ul>
	);
}
