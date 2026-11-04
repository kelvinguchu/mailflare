"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowDownToLine, CalendarPlus, FileWarning } from "lucide-react";
import { InvitationDialog, type InvitationSource } from "./calendar/invitation-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { authFetch } from "@/lib/auth/client";
import { Skeleton } from "@/components/ui/skeleton";
import { detectPreviewType, MAX_TEXT_PREVIEW_BYTES, previewKind } from "@/lib/email/preview";
import type { MessageAttachmentViewerProps } from "./message-attachment-viewer-types";
import { getAttachmentFileUrl } from "./message-attachment-viewer-utils";

export function MessageAttachmentViewer({
	attachment,
	messageId,
	onOpenChange,
	open,
	localFile,
	proposedAttendees,
	inspection = false,
}: MessageAttachmentViewerProps) {
	const [preview, setPreview] = useState<{ url: string; type: string; text?: string } | null>(null);
	const [error, setError] = useState("");
	const [invitation, setInvitation] = useState<InvitationSource | null>(null);
	const remoteUrl = attachment
		? getAttachmentFileUrl(messageId, attachment.id, "preview", inspection)
		: "";
	useEffect(() => {
		if (!open || !attachment) return;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15_000);
		let objectUrl: string | undefined;
		setPreview(null);
		setError("");
		void (async () => {
			let type: string;
			let url = remoteUrl;
			if (localFile) {
				type = detectPreviewType(
					new Uint8Array(await localFile.slice(0, 512).arrayBuffer()),
					localFile.type,
				);
				if (controller.signal.aborted) return;
				objectUrl = URL.createObjectURL(new Blob([localFile], { type }));
				url = objectUrl;
			} else {
				const response = await authFetch(url, { method: "HEAD", signal: controller.signal });
				if (!response.ok) throw new Error("Could not load this attachment");
				type = response.headers.get("X-Preview-Type") ?? "application/octet-stream";
			}
			let text: string | undefined;
			if (previewKind(type) === "text") {
				if (localFile) text = await localFile.slice(0, MAX_TEXT_PREVIEW_BYTES).text();
				else if (attachment.size === 0) text = "";
				else {
					const response = await authFetch(url, {
						headers: { Range: `bytes=0-${MAX_TEXT_PREVIEW_BYTES - 1}` },
						signal: controller.signal,
					});
					if (!response.ok) throw new Error("Could not load this attachment");
					// The authenticated endpoint honors Range and bounds this response.
					text = await response.text();
				}
			}
			clearTimeout(timeout);
			if (!controller.signal.aborted) setPreview({ url, type, text });
		})().catch(() => {
			if (!controller.signal.aborted)
				setError("Preview unavailable. Download the file to open it.");
		});
		controller.signal.addEventListener(
			"abort",
			() => setError("Preview timed out. Download the file to open it."),
			{ once: true },
		);
		return () => {
			clearTimeout(timeout);
			controller.abort();
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [attachment, localFile, open, remoteUrl]);
	if (!attachment) return null;
	if (invitation)
		return (
			<InvitationDialog
				source={invitation}
				proposedAttendees={proposedAttendees}
				onClose={() => setInvitation(null)}
			/>
		);
	const kind = preview ? previewKind(preview.type) : "unsupported";
	const downloadUrl = localFile
		? preview?.url
		: getAttachmentFileUrl(messageId, attachment.id, "download", inspection);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex h-[min(88vh,900px)] w-[min(1100px,calc(100vw-32px))] flex-col overflow-hidden">
				<DialogHeader className="shrink-0 pr-10">
					<DialogTitle className="truncate">{attachment.filename}</DialogTitle>
					<DialogDescription>{preview?.type ?? attachment.type}</DialogDescription>
				</DialogHeader>
				<DialogBody className="flex min-h-0 flex-1 flex-col">
					<div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg bg-neutral-100">
						{error ? (
							<p role="alert" className="p-5 text-sm text-neutral-600">
								{error}
							</p>
						) : !preview ? (
							<Skeleton className="h-full w-full" />
						) : (
							<>
								{kind === "image" && (
									<Image
										src={preview.url}
										alt={attachment.filename}
										width={1600}
										height={1200}
										unoptimized
										className="max-h-full max-w-full object-contain"
										onError={() =>
											setError("Could not preview this image. Download it to open it.")
										}
									/>
								)}
								{kind === "pdf" && (
									<iframe
										src={preview.url}
										title={attachment.filename}
										className="h-full w-full border-0 bg-white"
										onError={() => setError("Could not preview this PDF. Download it to open it.")}
									/>
								)}
								{kind === "audio" && (
									<audio
										src={preview.url}
										controls
										aria-label={`Audio preview of ${attachment.filename}`}
										className="w-[min(560px,90%)]"
										onError={() =>
											setError("This browser cannot play the file. Download it to open it.")
										}
									/>
								)}
								{kind === "video" && (
									<video
										src={preview.url}
										controls
										aria-label={`Video preview of ${attachment.filename}`}
										className="max-h-full max-w-full"
										onError={() =>
											setError("This browser cannot play the file. Download it to open it.")
										}
									/>
								)}
								{kind === "text" && (
									<pre className="h-full w-full overflow-auto whitespace-pre-wrap p-5 text-sm text-neutral-800">
										{preview.text || "Empty file"}
										{attachment.size > MAX_TEXT_PREVIEW_BYTES
											? "\n\nPreview truncated. Download for the full file."
											: ""}
									</pre>
								)}
								{kind === "unsupported" && (
									<div className="flex flex-col items-center gap-3 px-6 text-center">
										<FileWarning className="h-10 w-10 text-neutral-400" />
										<p className="text-sm text-neutral-600">
											Preview unavailable for this file type.
										</p>
									</div>
								)}
							</>
						)}
					</div>
					<div className="flex shrink-0 justify-end gap-2">
						{!inspection && preview?.type === "text/calendar" && (
							<Button
								variant="outline"
								onClick={() =>
									setInvitation(
										localFile ? { file: localFile } : { messageId, attachmentId: attachment.id },
									)
								}
							>
								<CalendarPlus className="h-4 w-4" />
								{localFile ? "Create meeting" : "Add to calendar"}
							</Button>
						)}
						<Button asChild>
							<a href={downloadUrl} download={attachment.filename}>
								<ArrowDownToLine className="h-4 w-4" />
								Download
							</a>
						</Button>
					</div>
				</DialogBody>
			</DialogContent>
		</Dialog>
	);
}
