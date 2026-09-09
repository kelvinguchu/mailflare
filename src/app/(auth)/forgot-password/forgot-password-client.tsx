"use client";

import Link from "next/link";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { TurnstileField } from "@/components/auth/turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordClient() {
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [turnstileReset, setTurnstileReset] = useState(0);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setLoading(true);
		setError(null);
		setMessage(null);
		try {
			const form = new FormData(event.currentTarget);
			const response = await fetch("/api/auth/password-reset/request", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				signal: AbortSignal.timeout(20_000),
				body: JSON.stringify({
					email: form.get("email"),
					turnstileToken: form.get("turnstileToken"),
				}),
			});
			const data = (await response.json()) as { error?: string; message?: string };
			if (!response.ok) throw new Error(data.error ?? "Unable to request a reset link");
			setMessage(data.message ?? "If the account can be recovered, a reset link will arrive shortly.");
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Unable to request a reset link");
			setTurnstileReset((value) => value + 1);
		} finally {
			setLoading(false);
		}
	}

	return (
		<AuthShell
			icon={KeyRound}
			title="Reset your password"
			description="Enter your account email. We will send a short-lived link to its verified recovery address."
		>
			<form onSubmit={onSubmit} className="space-y-5">
				<div className="space-y-2">
					<Label htmlFor="email">Account email</Label>
					<Input id="email" name="email" type="email" autoComplete="email" required />
				</div>
				{message && (
					<p className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
						{message}
					</p>
				)}
				{error && (
					<p className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
						{error}
					</p>
				)}
				<TurnstileField resetSignal={turnstileReset} />
				<Button type="submit" className="h-11 w-full rounded-full" disabled={loading}>
					{loading ? "Requesting..." : "Send reset link"}
				</Button>
				<p className="text-center text-sm text-neutral-500">
					<Link href="/login" className="font-medium text-neutral-800 hover:text-neutral-950">
						Back to sign in
					</Link>
				</p>
			</form>
		</AuthShell>
	);
}
