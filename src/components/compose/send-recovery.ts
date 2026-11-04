import { authFetch } from "@/lib/auth/client";
import type { ComposeSnapshot } from "./types";

type Recovery = { key: string; owner: string; snapshot: ComposeSnapshot; savedAt: number };

async function accountId(): Promise<string> {
	const response = await authFetch("/api/auth/me", {
		signal: AbortSignal.timeout(10_000),
		redirectOnUnauthorized: false,
	});
	const data = (await response.json()) as { user?: { id: string } };
	if (!response.ok || !data.user?.id) throw new Error("Recovery requires an active session");
	return data.user.id;
}

async function recoveryStore<T>(
	mode: IDBTransactionMode,
	action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	return new Promise((resolve, reject) => {
		let database: IDBDatabase | undefined;
		let settled = false;
		const fail = (error: unknown) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			database?.close();
			reject(error);
		};
		const timer = setTimeout(() => fail(new Error("Recovery storage timed out")), 10_000);
		const open = indexedDB.open("mailflare-send-recovery", 1);
		open.onupgradeneeded = () => open.result.createObjectStore("sends", { keyPath: "key" });
		open.onerror = () => fail(open.error);
		open.onblocked = () => fail(new Error("Recovery storage is busy"));
		open.onsuccess = () => {
			const db = open.result;
			if (settled) {
				db.close();
				return;
			}
			database = db;
			try {
				const transaction = db.transaction("sends", mode);
				const request = action(transaction.objectStore("sends"));
				transaction.oncomplete = () => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					db.close();
					resolve(request.result);
				};
				transaction.onerror = transaction.onabort = () => {
					fail(transaction.error);
				};
			} catch (error) {
				fail(error);
			}
		};
	});
}

/** IndexedDB structured clones File bytes; recovery stays private to this device/account. */
export async function saveSendRecovery(snapshot: ComposeSnapshot): Promise<void> {
	const owner = await accountId();
	await recoveryStore("readwrite", (store) =>
		store.put({ key: snapshot.sendKey, owner, snapshot, savedAt: Date.now() } satisfies Recovery),
	);
}

export async function listSendRecoveries(): Promise<ComposeSnapshot[]> {
	const owner = await accountId();
	const records = await recoveryStore<Recovery[]>("readonly", (store) => store.getAll());
	return records
		.filter((record) => record.owner === owner && !record.key.startsWith("draft:"))
		.map((record) => record.snapshot);
}

export async function saveDraftFiles(
	draftId: string,
	attachments: ComposeSnapshot["attachments"],
): Promise<void> {
	const owner = await accountId();
	await recoveryStore("readwrite", (store) =>
		store.put({ key: `draft:${draftId}`, owner, attachments }),
	);
}

export async function loadDraftFiles(draftId: string): Promise<ComposeSnapshot["attachments"]> {
	const owner = await accountId();
	const record = await recoveryStore<
		{ owner: string; attachments: ComposeSnapshot["attachments"] } | undefined
	>("readonly", (store) => store.get(`draft:${draftId}`));
	return record?.owner === owner ? record.attachments : [];
}

export async function removeSendRecovery(key: string): Promise<void> {
	await recoveryStore("readwrite", (store) => store.delete(key));
}
