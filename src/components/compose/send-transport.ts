import { authFetch, notifyAuthSessionChanged } from "@/lib/auth/client";
import type { ComposeSnapshot, SendResponse } from "./types";
import { buildSendFormData } from "./utils";

export const SEND_TIMEOUT_MS = 90_000;

/** XHR exposes actual multipart bytes transferred; fetch has no upload progress. */
export function uploadSend(
	snapshot: ComposeSnapshot,
	progress: (percent: number | null) => void,
): Promise<{ ok: boolean; data: SendResponse }> {
	return new Promise((resolve, reject) => {
		const request = new XMLHttpRequest();
		request.open("POST", "/api/send");
		request.timeout = SEND_TIMEOUT_MS;
		request.setRequestHeader("Idempotency-Key", snapshot.sendKey);
		request.setRequestHeader("X-Undo-Send-Delay-Seconds", snapshot.undoDelaySeconds);
		request.upload.onprogress = (event) =>
			progress(event.lengthComputable ? Math.round((event.loaded * 100) / event.total) : null);
		request.upload.onload = () => progress(100);
		request.onerror = () => reject(new Error("Connection lost"));
		request.ontimeout = () => reject(new Error("Send confirmation timed out"));
		request.onabort = () => reject(new Error("Upload canceled"));
		request.onload = () => {
			if (request.status >= 500) {
				reject(new Error("Server confirmation failed"));
				return;
			}
			if (request.status === 401) {
				notifyAuthSessionChanged(false);
				window.location.replace("/login");
			}
			let data: SendResponse = {};
			try {
				data = JSON.parse(request.responseText) as SendResponse;
			} catch {
				/* Reconcile malformed responses using the key. */
			}
			if (request.status >= 200 && request.status < 300 && !data.jobId) {
				reject(new Error("Send response was incomplete"));
				return;
			}
			resolve({ ok: request.status >= 200 && request.status < 300, data });
		};
		request.send(
			buildSendFormData({
				...snapshot,
				text: snapshot.forward ? snapshot.forward.note : snapshot.text,
				forwardMessageId: snapshot.forward?.messageId,
				mailboxId: snapshot.mailboxId ?? undefined,
				includeSignature: snapshot.includeSignature ?? true,
			}),
		);
	});
}

export async function lookupSend(key: string): Promise<{ found: boolean; data: SendResponse }> {
	const response = await authFetch("/api/send", {
		headers: { "Idempotency-Key": key },
		signal: AbortSignal.timeout(10_000),
	});
	if (response.status === 404) return { found: false, data: {} };
	if (!response.ok) throw new Error("Could not check send status");
	return { found: true, data: (await response.json()) as SendResponse };
}
