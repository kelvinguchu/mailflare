import type { ToastManagerUpdateOptions } from "@base-ui/react/toast";
import { toast } from "@/components/ui/toast";
import { authFetch } from "@/lib/auth/client";
import type { ComposeSnapshot, SendResponse } from "./types";
import { buildSendFormData } from "./utils";

const MESSAGES_CHANGED_EVENT = "mailflare:messages-changed";
const RESULT_TOAST_MS = 5_000;

type SendWithUndoOptions = {
	snapshot: ComposeSnapshot;
	/** Resolves to the draft to delete once the send is accepted, after any in-flight autosave. */
	draftId: Promise<string | null>;
	/** Reopens the composer with the message, after Undo or a failed send. */
	restore: (snapshot: ComposeSnapshot) => void;
};

/**
 * Sends a message from a composer that has already closed. One toast follows the
 * message from "Sending…" to "Message sent" with Undo until the server's deadline.
 */
export function sendWithUndo({ snapshot, draftId, restore }: SendWithUndoOptions): void {
	const status = createStatusToast({ type: "loading", title: "Sending…", timeout: 0 });
	void deliver();

	async function deliver() {
		let response: Response;
		let data: SendResponse;
		try {
			response = await authFetch("/api/send", {
				method: "POST",
				headers: {
					"Idempotency-Key": snapshot.sendKey,
					"X-Undo-Send-Delay-Seconds": snapshot.undoDelaySeconds,
				},
				body: buildSendFormData({
					attachments: snapshot.attachments,
					from: snapshot.from,
					includeSignature: snapshot.includeSignature ?? true,
					to: snapshot.to,
					cc: snapshot.cc,
					subject: snapshot.subject,
					text: snapshot.text,
					mailboxId: snapshot.mailboxId ?? undefined,
					replyToMessageId: snapshot.replyToMessageId,
				}),
			});
			data = (await response.json().catch(() => ({}))) as SendResponse;
		} catch {
			// The same Idempotency-Key makes retrying an unconfirmed send safe.
			status.show({
				type: "error",
				title: "Message not sent",
				description: "The connection dropped before the send was confirmed.",
				timeout: 0,
				actionProps: {
					children: "Retry",
					onClick: () => {
						status.close();
						sendWithUndo({ snapshot, draftId, restore });
					},
				},
			});
			return;
		}

		if (!response.ok) {
			status.show({
				type: "error",
				title: "Message not sent",
				description: data.error ?? "Something went wrong while sending.",
				timeout: 0,
				actionProps: {
					children: "Edit message",
					onClick: () => {
						status.close();
						void draftId.then((id) => restore({ ...snapshot, draftId: id }));
					},
				},
			});
			return;
		}

		void draftId
			.then((id) => (id ? authFetch(`/api/drafts/${id}`, { method: "DELETE" }) : null))
			.catch(() => null)
			.finally(() => window.dispatchEvent(new Event(MESSAGES_CHANGED_EVENT)));

		if (data.status !== "scheduled" || !data.jobId || !data.undoDeadline) {
			status.show({
				type: "success",
				title: "Message sent",
				timeout: RESULT_TOAST_MS,
				actionProps: undefined,
			});
			return;
		}

		const jobId = data.jobId;
		status.show({
			type: "success",
			title: "Message sent",
			// The server's deadline decides how long Undo is offered.
			timeout: Math.max(Date.parse(data.undoDeadline) - Date.now(), 1_000),
			actionProps: { children: "Undo", onClick: () => void undo(jobId) },
		});
	}

	async function undo(jobId: string) {
		status.show({ type: "loading", title: "Undoing…", timeout: 0, actionProps: undefined });
		try {
			const response = await authFetch(`/api/send/${jobId}/cancel`, { method: "POST" });
			const data = (await response.json().catch(() => ({}))) as SendResponse;
			if (response.ok) {
				status.show({ type: "info", title: "Sending undone", timeout: RESULT_TOAST_MS });
				// The canceled job owns the old key; resending must start a new send.
				restore({ ...snapshot, sendKey: crypto.randomUUID(), draftId: null });
				window.dispatchEvent(new Event(MESSAGES_CHANGED_EVENT));
				return;
			}
			status.show({
				type: "error",
				title: response.status === 409 ? "Too late to undo" : "Couldn’t undo",
				description:
					response.status === 409
						? "Delivery has already started."
						: (data.error ?? "The message may still be delivered."),
				timeout: RESULT_TOAST_MS,
			});
		} catch {
			status.show({
				type: "error",
				title: "Couldn’t confirm undo",
				description: "Delivery may have started.",
				timeout: RESULT_TOAST_MS,
			});
		}
	}
}

/**
 * A toast that can be updated for the whole send. If the viewer closes it early, the
 * next update opens a new toast rather than being dropped by the toast store.
 */
function createStatusToast(initial: ToastManagerUpdateOptions<object>) {
	let closed = false;
	const onClose = () => {
		closed = true;
	};
	let id = toast.add({ ...initial, onClose });
	return {
		show(options: ToastManagerUpdateOptions<object>) {
			if (closed) {
				closed = false;
				id = toast.add({ ...options, onClose });
			} else {
				toast.update(id, options);
			}
		},
		close() {
			toast.close(id);
		},
	};
}
