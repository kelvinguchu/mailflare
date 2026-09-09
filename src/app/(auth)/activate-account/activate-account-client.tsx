"use client";

import { UserRoundCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ActivateAccountClient({ token }: { token: string }) {
	const [error, setError] = useState<string | null>(token ? null : "This activation link is invalid.");
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (token) window.history.replaceState({}, "", "/activate-account");
	}, [token]);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const newPassword = String(form.get("newPassword") ?? "");
		const confirmPassword = String(form.get("confirmPassword") ?? "");
		if (newPassword !== confirmPassword) {
			setError("Passwords do not match");
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const response = await fetch("/api/auth/account-activation/confirm", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				signal: AbortSignal.timeout(20_000),
				body: JSON.stringify({ token, newPassword }),
			});
			const data = (await response.json()) as { error?: string; redirect?: string };
			if (!response.ok) throw new Error(data.error ?? "Unable to activate account");
			window.location.assign(data.redirect ?? "/inbox");
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Unable to activate account");
		} finally {
			setLoading(false);
		}
	}

	return (
		<AuthShell
			icon={UserRoundCheck}
			title="Activate your account"
			description="Choose your permanent password. This invitation is single-use and expires 72 hours after it was sent."
		>
			<form onSubmit={onSubmit} className="space-y-5">
				<div className="space-y-2">
					<Label htmlFor="newPassword">New password</Label>
					<Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
				</div>
				<div className="space-y-2">
					<Label htmlFor="confirmPassword">Confirm new password</Label>
					<Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
				</div>
				{error && (
					<p className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
						{error}
					</p>
				)}
				<Button type="submit" className="h-11 w-full rounded-full" disabled={loading || !token}>
					{loading ? "Activating..." : "Activate account"}
				</Button>
			</form>
		</AuthShell>
	);
}
