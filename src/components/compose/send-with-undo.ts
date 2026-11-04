import type { ToastManagerUpdateOptions } from "@base-ui/react/toast";
import { toast } from "@/components/ui/toast";
import { authFetch } from "@/lib/auth/client";
import type { ComposeSnapshot, SendResponse } from "./types";
import { lookupSend, uploadSend } from "./send-transport";
import { saveSendRecovery, removeSendRecovery } from "./send-recovery";
import { validateMessageBudget } from "@/lib/email/limits";

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
 * message through upload and queue acceptance, with Undo until the server deadline.
 */
export function sendWithUndo({ snapshot, draftId, restore }: SendWithUndoOptions): void {
	try {
		validateMessageBudget(
			snapshot,
			snapshot.attachments.map(({ file }) => ({ filename: file.name, size: file.size })),
		);
	} catch (error) {
		toast.add({
			type: "error",
			title: error instanceof Error ? error.message : "Message is too large",
		});
		restore(snapshot);
		return;
	}
	const status = createStatusToast({ type: "loading", title: "Preparing…", timeout: 0 });
	let monitoringStopped = false;
	void deliver();

	async function deliver() {
		let ok: boolean;
		let data: SendResponse;
		try {
			await saveSendRecovery(snapshot);
		} catch {
			status.show({
				type: "error",
				title: "Couldn’t save the message",
				description: "Allow browser storage, then try again.",
				timeout: RESULT_TOAST_MS,
			});
			restore(snapshot);
			return;
		}
		try {
			// Always check before resubmitting a restored or unconfirmed send.
			const prior = await lookupSend(snapshot.sendKey);
			if (prior.found) {
				data = prior.data;
				ok = true;
			} else {
				({ ok, data } = await uploadSend(snapshot, (percent) =>
					status.show({
						type: "loading",
						title:
							percent === 100
								? "Preparing message…"
								: percent === null
									? "Uploading…"
									: `Uploading ${percent}%`,
						timeout: 0,
					}),
				));
			}
		} catch {
			status.show({ type: "loading", title: "Checking send status…", timeout: 0 });
			try {
				const outcome = await lookupSend(snapshot.sendKey);
				if (!outcome.found) {
					showUnconfirmed();
					return;
				}
				data = outcome.data;
				ok = true;
			} catch {
				showUnconfirmed();
				return;
			}
		}

		if (!ok || data.status === "failed" || data.status === "canceled") {
			if (data.deliveryStatus === "unknown") {
				status.show({
					type: "error",
					title: "Send outcome unknown",
					description:
						"Provider acceptance could not be confirmed. Check Sent before attempting another send.",
					timeout: 0,
					actionProps: undefined,
				});
				return;
			}
			status.show({
				type: "error",
				title: data.deliveryStatus === "unknown" ? "Send outcome unknown" : "Message not sent",
				description: data.error ?? "Something went wrong while sending.",
				timeout: 0,
				actionProps: {
					children: "Edit message",
					onClick: () => {
						status.close();
						void draftId.then((id) =>
							restore({
								...snapshot,
								draftId: id,
								sendKey:
									ok && data.deliveryStatus !== "unknown" ? crypto.randomUUID() : snapshot.sendKey,
							}),
						);
					},
				},
			});
			return;
		}
		if (data.status === "sent") void removeSendRecovery(snapshot.sendKey).catch(() => null);

		void draftId
			.then(async (id) => {
				if (id) {
					await authFetch(`/api/drafts/${id}/consume`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ messageId: data.messageId }),
						signal: AbortSignal.timeout(10_000),
					});
					await removeSendRecovery(`draft:${id}`);
				}
			})
			.catch(() => null)
			.finally(() => window.dispatchEvent(new Event(MESSAGES_CHANGED_EVENT)));

		if (data.status !== "scheduled" || !data.jobId || !data.undoDeadline) {
			status.show({
				type: "success",
				title:
					data.status === "sent"
						? "Provider accepted"
						: data.status === "sending"
							? "Sending…"
							: "Message queued",
				timeout: RESULT_TOAST_MS,
				actionProps: undefined,
			});
			if (data.status !== "sent") monitorOutcome();
			return;
		}

		const jobId = data.jobId;
		status.show({
			type: "success",
			title: "Message queued",
			// The server's deadline decides how long Undo is offered.
			timeout: Math.max(Date.parse(data.undoDeadline) - Date.now(), 1_000),
			actionProps: { children: "Undo", onClick: () => void undo(jobId) },
		});
		monitorOutcome(Math.max(Date.parse(data.undoDeadline) - Date.now(), 0) + 1000);
	}

	function monitorOutcome(delay = 3000) {
		const deadline = Date.now() + delay + 120_000;
		const check = async () => {
			if (monitoringStopped || Date.now() >= deadline) return;
			try {
				const outcome = await lookupSend(snapshot.sendKey);
				if (monitoringStopped || !outcome.found) return;
				const data = outcome.data;
				window.dispatchEvent(new Event(MESSAGES_CHANGED_EVENT));
				if (data.status === "sent") {
					void removeSendRecovery(snapshot.sendKey).catch(() => null);
					status.show({
						type: "success",
						title: "Provider accepted",
						timeout: RESULT_TOAST_MS,
						actionProps: undefined,
					});
					return;
				}
				if (data.status === "failed" || data.status === "canceled") {
					const unknown = data.deliveryStatus === "unknown";
					status.show({
						type: "error",
						title: unknown ? "Send outcome unknown" : "Message not sent",
						description: unknown
							? "Check Sent before attempting another send."
							: (data.error ?? "Your message is saved on this device."),
						timeout: 0,
						actionProps: unknown
							? undefined
							: {
									children: "Edit message",
									onClick: () => {
										status.close();
										restore({ ...snapshot, draftId: null, sendKey: crypto.randomUUID() });
									},
								},
					});
					return;
				}
				status.show({
					type: "loading",
					title: data.status === "sending" ? "Sending…" : "Message queued",
					timeout: 5000,
					actionProps: undefined,
				});
			} catch {
				/* The queue continues independently; polling never resubmits. */
			}
			if (Date.now() < deadline) setTimeout(() => void check(), 3000);
		};
		setTimeout(() => void check(), delay);
	}

	function showUnconfirmed() {
		status.show({
			type: "error",
			title: "Send not confirmed",
			description: "Your message is saved on this device. Check again before retrying.",
			timeout: 0,
			actionProps: {
				children: "Check status",
				onClick: () => {
					status.close();
					sendWithUndo({ snapshot, draftId, restore });
				},
			},
		});
	}

	async function undo(jobId: string) {
		monitoringStopped = true;
		status.show({ type: "loading", title: "Undoing…", timeout: 0, actionProps: undefined });
		try {
			const response = await authFetch(`/api/send/${jobId}/cancel`, {
				method: "POST",
				signal: AbortSignal.timeout(10_000),
			});
			const data = (await response.json().catch(() => ({}))) as SendResponse;
			if (response.ok) {
				void removeSendRecovery(snapshot.sendKey).catch(() => null);
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
