"use client";

import { MfaSettings } from "@/components/settings/mfa-settings";
import { Button } from "@/components/ui/button";
import { authFetch, notifyAuthSessionChanged } from "@/lib/auth/client";

export function MfaEnrollment() {
	async function logout() {
		await authFetch("/api/auth/logout", { method: "POST", redirectOnUnauthorized: false });
		notifyAuthSessionChanged(false);
		window.location.replace("/login");
	}

	async function recoverAccount() {
		await authFetch("/api/auth/logout", { method: "POST", redirectOnUnauthorized: false });
		notifyAuthSessionChanged(false);
		window.location.replace("/forgot-password");
	}

	return (
		<>
			<MfaSettings enrollmentMode />
			<Button type="button" variant="ghost" className="mt-6 w-full" onClick={() => void logout()}>
				Sign out
			</Button>
			<Button
				type="button"
				variant="link"
				className="mt-2 w-full"
				onClick={() => void recoverAccount()}
			>
				Recover account
			</Button>
		</>
	);
}
