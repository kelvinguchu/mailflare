"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Mail } from "lucide-react";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TurnstileField } from "@/components/auth/turnstile";
import { submitLogin, submitMfaChallenge } from "./utils";

export function LoginClient() {
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [turnstileReset, setTurnstileReset] = useState(0);
	const [challengeToken, setChallengeToken] = useState<string | null>(null);

	async function onSubmit(e: React.SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		setLoading(true);
		setError(null);

		try {
			const form = new FormData(e.currentTarget);
			const { ok, data } = challengeToken
				? await submitMfaChallenge(challengeToken, form.get("code"))
				: await submitLogin(form);
			if (!ok) {
				setError(data.error ?? "Login failed");
				if (!challengeToken) setTurnstileReset((value) => value + 1);
				return;
			}
			if (data.mfaRequired && data.challengeToken) {
				setChallengeToken(data.challengeToken);
				setError(null);
				return;
			}
			router.replace(data.redirect ?? "/inbox");
			router.refresh();
		} catch (error) {
			setError(
				error instanceof DOMException && error.name === "TimeoutError"
					? "Login timed out. Please try again."
					: "Unable to reach the login service. Please try again.",
			);
			if (!challengeToken) setTurnstileReset((value) => value + 1);
		} finally {
			setLoading(false);
		}
	}

	return (
		<AuthShell
			icon={Mail}
			title={challengeToken ? "Two-factor check" : "Access your mailbox"}
			description={
				challengeToken
					? "Enter the code from your authenticator app, or use one of your recovery codes."
					: "Sign in with the address issued by your administrator."
			}
		>
			<form method="post" onSubmit={onSubmit} className="space-y-5">
				{challengeToken ? (
					<div className="space-y-2">
						<Label htmlFor="code">Verification code</Label>
						<Input
							id="code"
							name="code"
							type="text"
							inputMode="text"
							autoComplete="one-time-code"
							autoFocus
							required
							placeholder="123456 or recovery code"
						/>
					</div>
				) : (
					<>
						<div className="space-y-2">
							<Label htmlFor="email">Email</Label>
							<Input id="email" name="email" type="email" autoComplete="email" required />
						</div>
						<div className="space-y-2">
							<div className="flex items-baseline justify-between gap-3">
								<Label htmlFor="password">Password</Label>
								<Link
									href="/forgot-password"
									className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-[#a89c8b] transition-colors hover:text-[#c96a15]"
								>
									Forgot password?
								</Link>
							</div>
							<Input
								id="password"
								name="password"
								type="password"
								autoComplete="current-password"
								required
							/>
						</div>
						<TurnstileField resetSignal={turnstileReset} />
					</>
				)}
				{error && (
					<p
						role="alert"
						className="border-l-2 border-[#b4331f] bg-[#faeae6] px-4 py-3 text-sm leading-5 text-[#8f2a19]"
					>
						{error}
					</p>
				)}
				<Button type="submit" className="h-11 w-full px-6 active:scale-[0.99]" disabled={loading}>
					{loading ? "Checking..." : challengeToken ? "Verify and sign in" : "Sign in"}
				</Button>
				{challengeToken && (
					<Button
						type="button"
						variant="ghost"
						className="h-10 w-full text-[#6c6353] hover:bg-[#ece7dc]"
						onClick={() => {
							setChallengeToken(null);
							setError(null);
							setTurnstileReset((value) => value + 1);
						}}
					>
						Use a different account
					</Button>
				)}
			</form>
		</AuthShell>
	);
}
