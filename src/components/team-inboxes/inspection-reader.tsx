"use client";
import { InspectionStateBadge } from "./inspection-state-badge";
import { useMemo, useState } from "react";
import { authFetch } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExpandedConversationMessage } from "@/components/conversation/conversation-message";
import { Reauthentication } from "@/components/settings/reauthentication";
import type { InspectionMessage } from "./types";
const labels: Record<string, string> = {
	trashed: "Moved to Trash",
	removed: "Deleted from Trash",
	restored: "Restored",
	draft_discarded: "Draft discarded",
	automatic_expiry: "Automatically removed after Trash expiry",
	historical_trash: "Historical deletion; actor unavailable",
};
export function InspectionReader({
	data,
	mfaEnabled,
	onRemoved,
}: {
	data: InspectionMessage;
	mfaEnabled: boolean;
	onRemoved: () => void;
}) {
	const { message, body, attachments, history } = data;
	const [confirm, setConfirm] = useState(false),
		[text, setText] = useState(""),
		[error, setError] = useState(""),
		[reauth, setReauth] = useState(false),
		[busy, setBusy] = useState(false);
	const detail = useMemo(() => ({ message, body, attachments }), [message, body, attachments]);

	async function purge() {
		setBusy(true);
		try {
			const response = await authFetch(`/api/team-inboxes/messages/${message.id}`, {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ confirmation: text }),
			});
			const result = (await response.json()) as { error?: string };
			if (response.status === 428) setReauth(true);
			if (!response.ok) throw new Error(result.error ?? "Removal failed");
			onRemoved();
		} catch (reason) {
			setError(String(reason));
		} finally {
			setBusy(false);
		}
	}
	return (
		<section className="border-b border-neutral-100">
			<ExpandedConversationMessage
				message={message}
				inspection={detail}
				collapsible={false}
				onCollapse={() => {}}
				onReply={() => {}}
				onForward={() => {}}
			/>
			{(history.length > 0 || message.employeeHiddenAt || message.status === "trash") && (
				<details className="mx-4 mb-3 text-xs text-neutral-500 sm:ml-[76px]">
					<summary className="cursor-pointer">
						<InspectionStateBadge
							state={
								message.employeeHiddenAt
									? "deleted"
									: message.status === "trash"
										? "trash"
										: "history"
							}
							className="mr-2"
						/>
						Deletion details
					</summary>
					<div className="space-y-1 py-2">
						<p>
							Original location:{" "}
							{message.deletionOriginalFolderName ??
								message.deletionOriginalStatus ??
								"Historical location unavailable"}
						</p>
						{history.map((event) => (
							<p key={event.id}>
								{labels[event.action] ?? event.action} · {event.actorEmail ?? "Actor not recorded"}{" "}
								· {new Date(event.createdAt).toLocaleString()}
							</p>
						))}

						{message.employeeHiddenAt && (
							<div className="mt-4 border-t pt-3">
								{!confirm ? (
									<Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
										Permanently remove retained message
									</Button>
								) : (
									<div className="space-y-3">
										<p className="text-sm">
											This removes the retained message and stored attachments. Type{" "}
											<strong>permanently-delete-retained-message</strong> to confirm.
										</p>
										<Input
											aria-label="Permanent removal confirmation"
											value={text}
											onChange={(event) => setText(event.target.value)}
										/>
										{reauth && <Reauthentication mfaEnabled={mfaEnabled} />}
										<div className="flex gap-2">
											<Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
												Cancel
											</Button>
											<Button
												disabled={busy || text !== "permanently-delete-retained-message"}
												onClick={() => void purge()}
											>
												Permanently remove
											</Button>
										</div>
										{error && (
											<p role="alert" className="text-sm text-red-700">
												{error}
											</p>
										)}
									</div>
								)}
							</div>
						)}
					</div>
				</details>
			)}
		</section>
	);
}
