import { authFetch } from "@/lib/auth/client";
import type {
	AccountDetail,
	AccountDetailResponse,
	AccountMailboxItem,
	DomainOption,
	ManagedAccount,
	ManagedDomain,
	ManagedMailbox,
} from "./types";

export async function fetchAccount(accountId: string): Promise<AccountDetail> {
	const res = await authFetch(`/api/accounts/${accountId}`);
	const json = (await res.json()) as AccountDetailResponse;
	if (!res.ok || !json.account) throw new Error(json.error ?? "Failed to load account");
	return json.account;
}

export async function updateAccount(
	accountId: string,
	input: { email: string; name: string; password?: string; disabled: boolean },
): Promise<void> {
	const res = await authFetch(`/api/accounts/${accountId}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	const json = (await res.json()) as { error?: string };
	if (!res.ok) throw new Error(json.error ?? "Failed to update account");
}

export async function fetchDomains(): Promise<DomainOption[]> {
	const res = await authFetch("/api/domains");
	const json = (await res.json()) as { domains?: DomainOption[]; error?: string };
	if (!res.ok) throw new Error(json.error ?? "Failed to load domains");
	return json.domains ?? [];
}

export async function fetchAccountMailboxes(accountId: string): Promise<AccountMailboxItem[]> {
	const res = await authFetch(`/api/accounts/${accountId}/mailboxes`);
	const json = (await res.json()) as { mailboxes?: AccountMailboxItem[]; error?: string };
	if (!res.ok) throw new Error(json.error ?? "Failed to load account mailboxes");
	return json.mailboxes ?? [];
}

export async function createAccountMailbox(
	accountId: string,
	input: { domainId: string; localPart: string; displayName?: string },
): Promise<void> {
	const res = await authFetch(`/api/accounts/${accountId}/mailboxes`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	const json = (await res.json()) as { error?: string };
	if (!res.ok) throw new Error(json.error ?? "Failed to create mailbox");
}

export async function fetchManagedAccount(accountId: string): Promise<ManagedAccount> {
	const response = await authFetch(`/api/accounts/${accountId}`);
	const data = (await response.json()) as { account?: ManagedAccount; error?: string };
	if (!response.ok || !data.account) throw new Error(data.error ?? "Unable to load account");
	return data.account;
}

export async function saveManagedAccount(account: ManagedAccount): Promise<void> {
	const response = await authFetch(`/api/accounts/${account.id}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			name: account.name,
			role: account.role,
			disabled: account.disabled,
			canManageMailboxes: account.canManageMailboxes,
			forwardingEmail: account.forwardingEmail,
		}),
	});
	const data = (await response.json()) as { error?: string };
	if (!response.ok) throw new Error(data.error ?? "Unable to update account");
}

export async function uploadManagedAccountAvatar(accountId: string, file: File): Promise<void> {
	const form = new FormData();
	form.set("file", file);
	const response = await authFetch(`/api/accounts/${accountId}/avatar`, { method: "POST", body: form });
	if (!response.ok) throw new Error("Unable to update avatar");
}

export async function fetchManagedMailboxes(accountId: string): Promise<ManagedMailbox[]> {
	const response = await authFetch(`/api/accounts/${accountId}/mailboxes`);
	const data = (await response.json()) as { mailboxes?: ManagedMailbox[]; error?: string };
	if (!response.ok) throw new Error(data.error ?? "Unable to load mailboxes");
	return data.mailboxes ?? [];
}

export async function updateManagedMailboxName(mailboxId: string, displayName: string): Promise<void> {
	const response = await authFetch(`/api/mailboxes/${mailboxId}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ displayName }),
	});
	const data = (await response.json()) as { error?: string };
	if (!response.ok) throw new Error(data.error ?? "Unable to update sender name");
}

export async function fetchManagedDomains(): Promise<ManagedDomain[]> {
	const response = await authFetch("/api/domains");
	const data = (await response.json()) as { domains?: ManagedDomain[]; error?: string };
	if (!response.ok) throw new Error(data.error ?? "Unable to load domains");
	return data.domains ?? [];
}

export async function addManagedMailbox(
	account: ManagedAccount,
	input: { domainId: string; localPart: string },
): Promise<void> {
	const response = await authFetch("/api/mailboxes", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			ownerUserId: account.id,
			domainId: input.domainId,
			localPart: input.localPart,
			displayName: account.name,
			type: "personal",
		}),
	});
	const data = (await response.json()) as { error?: string };
	if (!response.ok) throw new Error(data.error ?? "Unable to add mailbox");
}

export async function removeManagedMailbox(mailboxId: string): Promise<void> {
	const response = await authFetch(`/api/mailboxes/${mailboxId}`, { method: "DELETE" });
	const data = (await response.json()) as { error?: string };
	if (!response.ok) throw new Error(data.error ?? "Unable to remove mailbox");
}
