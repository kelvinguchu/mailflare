import { authFetch, notifyAuthSessionChanged } from "@/lib/auth/client";

export async function logoutClientSession(): Promise<void> {
	const response = await authFetch("/api/auth/logout", {
		method: "POST",
		redirectOnUnauthorized: false,
	});
	if (!response.ok) throw new Error("Could not log out");
	notifyAuthSessionChanged(false);
}
