"use client";

import Link from "next/link";
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetPasswordClient({ token }: { token: string }) {
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(token ? null : "This reset link is invalid.");
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (token) window.history.replaceState({}, "", "/reset-password");
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
			const response = await fetch("/api/auth/password-reset/confirm", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				signal: AbortSignal.timeout(20_000),
				body: JSON.stringify({ token, newPassword }),
			});
			const data = (await response.json()) as { error?: string };
			if (!response.ok) throw new Error(data.error ?? "Unable to reset password");
			setMessage("Your password has been reset. All existing sessions have been signed out.");
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Unable to reset password");
		} finally {
			setLoading(false);
		}
	}

	return (
		<AuthShell
			icon={KeyRound}
			title="Choose a new password"
			description="This link is single-use and expires 30 minutes after it was requested."
		>
			{message ? (
				<div className="space-y-5">
					<p className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
						{message}
					</p>
					<Button asChild className="h-11 w-full rounded-full">
						<Link href="/login">Sign in</Link>
					</Button>
				</div>
			) : (
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
						{loading ? "Resetting..." : "Reset password"}
					</Button>
				</form>
			)}
		</AuthShell>
	);
}
