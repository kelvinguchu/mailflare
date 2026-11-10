"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth/client";
import { normalizeEmailAddress } from "@/lib/email/address";

function remoteImageSendersKey(mailboxId: string | null | undefined) {
	return ["remote-image-senders", mailboxId ?? null] as const;
}

/**
 * Senders whose remote images load without asking, shared by every open message in a mailbox.
 * Loaded once per mailbox and updated in place when the choice changes.
 */
export function useRemoteImageSenders(mailboxId: string | null | undefined) {
	const queryClient = useQueryClient();
	const key = remoteImageSendersKey(mailboxId);
	const query = useQuery({
		queryKey: key,
		enabled: !!mailboxId,
		staleTime: 5 * 60 * 1000,
		queryFn: async () => {
			const params = new URLSearchParams({ mailboxId: mailboxId ?? "" });
			const response = await authFetch(`/api/contacts/remote-images?${params.toString()}`);
			if (!response.ok) return [];
			const data = (await response.json()) as { addresses?: string[] };
			return data.addresses ?? [];
		},
	});

	function isAllowed(address: string | null | undefined) {
		if (!address) return false;
		return (query.data ?? []).includes(normalizeEmailAddress(address));
	}

	/** Saves the choice; resolves false when this account may not change it for the mailbox. */
	async function setAllowed(address: string, allowed: boolean) {
		if (!mailboxId) return false;
		const response = await authFetch("/api/contacts/remote-images", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ mailboxId, address, allowed }),
		});
		if (!response.ok) return false;
		const email = normalizeEmailAddress(address);
		queryClient.setQueryData<string[]>(key, (current = []) =>
			allowed ? Array.from(new Set([...current, email])) : current.filter((item) => item !== email),
		);
		return true;
	}

	return { isAllowed, setAllowed, loading: query.isPending && !!mailboxId };
}
