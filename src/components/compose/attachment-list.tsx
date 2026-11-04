"use client";

import { useMemo, useState } from "react";
import { FileText, X } from "lucide-react";
import { MessageAttachmentViewer } from "@/components/message-attachment-viewer";
import { cn } from "@/lib/utils";
import type { ComposeAttachment } from "./types";
import { formatAttachmentSize } from "./utils";
import { normalizeRecipients } from "@/lib/email/recipients";

export function AttachmentList({
	attachments,
	onRemove,
	className,
	to = "",
	cc = "",
}: Readonly<{
	attachments: ComposeAttachment[];
	onRemove: (id: string) => void;
	className?: string;
	to?: string;
	cc?: string;
}>) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const proposedAttendees = useMemo(() => {
		try {
			const people = normalizeRecipients({ to, cc });
			return [...people.to, ...people.cc].map((person) => person.address);
		} catch {
			return [];
		}
	}, [to, cc]);
	const selected = attachments.find((item) => item.id === selectedId);
	const metadata = useMemo(
		() =>
			selected
				? {
						id: selected.id,
						filename: selected.file.name,
						type: selected.file.type || "application/octet-stream",
						size: selected.file.size,
						messageId: "",
						contentId: null,
						disposition: "attachment" as const,
						securityStatus: "safe" as const,
						securityReason: null,
					}
				: null,
		[selected],
	);
	if (attachments.length === 0) return null;
	return (
		<div className={className}>
			<p className="mb-2 text-xs text-neutral-500">
				{attachments.length} files ·{" "}
				{formatAttachmentSize(attachments.reduce((total, item) => total + item.file.size, 0))} / 3
				MiB
			</p>
			<ul className={cn("flex flex-wrap gap-2", className)} aria-label="Attachments">
				{attachments.map((attachment) => (
					<li
						key={attachment.id}
						className="flex max-w-full items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 py-1.5 pr-1 pl-2.5 text-sm"
					>
						<FileText aria-hidden="true" className="size-4 shrink-0 text-neutral-500" />
						<button
							type="button"
							onClick={() => setSelectedId(attachment.id)}
							className="max-w-48 truncate text-left hover:underline"
							aria-label={`Preview ${attachment.file.name}`}
						>
							{attachment.file.name}
						</button>
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
			<MessageAttachmentViewer
				attachment={metadata}
				messageId=""
				localFile={selected?.file}
				proposedAttendees={proposedAttendees}
				open={Boolean(selected)}
				onOpenChange={(open) => !open && setSelectedId(null)}
			/>
		</div>
	);
}
