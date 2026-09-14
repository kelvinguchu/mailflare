import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth/client";

export type CurrentAccount = {
	id: string;
	name: string;
	email: string;
	role: string;
};

export const CURRENT_ACCOUNT_QUERY_KEY = ["auth", "current-account"] as const;

async function fetchCurrentAccount(): Promise<CurrentAccount> {
	const response = await authFetch("/api/auth/me", {
		cache: "no-store",
		redirectOnUnauthorized: false,
	});
	const data = (await response.json().catch(() => ({}))) as { user?: CurrentAccount };
	if (!response.ok || !data.user) throw new Error("Your session could not be loaded");
	return data.user;
}

/** The signed-in account, used to decide which actions the interface offers. */
export function useCurrentAccount() {
	return useQuery({
		queryKey: CURRENT_ACCOUNT_QUERY_KEY,
		queryFn: fetchCurrentAccount,
		staleTime: 5 * 60_000,
		retry: false,
	});
}
