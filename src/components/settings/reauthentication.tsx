"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authFetch } from "@/lib/auth/client";

export function Reauthentication({ mfaEnabled }: { mfaEnabled: boolean }) {
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const formElement = event.currentTarget;
		setLoading(true);
		setMessage(null);
		setError(null);
		try {
			const form = new FormData(formElement);
			const response = await authFetch("/api/auth/reauthenticate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					currentPassword: form.get("currentPassword"),
					code: form.get("code") ?? "",
				}),
			});
			const data = await response.json() as { error?: string };
			if (!response.ok) throw new Error(data.error ?? "Identity confirmation failed");
			formElement.reset();
			setMessage("Identity confirmed for high-risk actions for the next 15 minutes.");
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Identity confirmation failed");
		} finally {
			setLoading(false);
		}
	}

	return (
		<form onSubmit={submit} className="space-y-4">
			<div className="space-y-2">
				<Label htmlFor="reauth-password">Current password</Label>
				<Input id="reauth-password" name="currentPassword" type="password" autoComplete="current-password" required />
			</div>
			{mfaEnabled && (
				<div className="space-y-2">
					<Label htmlFor="reauth-code">Authenticator or recovery code</Label>
					<Input id="reauth-code" name="code" type="text" autoComplete="one-time-code" required />
				</div>
			)}
			<Button type="submit" disabled={loading}>{loading ? "Confirming…" : "Confirm identity"}</Button>
			{message && <p className="text-sm font-medium text-emerald-700">{message}</p>}
			{error && <p className="text-sm font-medium text-red-700">{error}</p>}
		</form>
	);
}
