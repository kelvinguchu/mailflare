"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OneTimeCodeInput } from "@/components/auth/one-time-code-input";
import { TurnstileField } from "@/components/auth/turnstile";
import { submitLogin, submitMfaChallenge } from "./utils";

export function LoginClient() {
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [turnstileReset, setTurnstileReset] = useState(0);
	const [challengeToken, setChallengeToken] = useState<string | null>(null);
	const [useRecoveryCode, setUseRecoveryCode] = useState(false);
	const [code, setCode] = useState("");
	const codeInputRef = useRef<HTMLInputElement>(null);
	const formRef = useRef<HTMLFormElement>(null);

	useEffect(() => {
		if (challengeToken) codeInputRef.current?.focus();
	}, [challengeToken, useRecoveryCode]);

	async function onSubmit(e: React.SubmitEvent<HTMLFormElement>) {
		e.preventDefault();
		setLoading(true);
		setError(null);

		try {
			const form = new FormData(e.currentTarget);
			const { ok, data } = challengeToken
				? await submitMfaChallenge(challengeToken, useRecoveryCode ? form.get("code") : code)
				: await submitLogin(form);
			if (!ok) {
				setError(data.error ?? "Login failed");
				if (challengeToken) {
					// Keep the user on the code field so they can retry immediately.
					if (useRecoveryCode) codeInputRef.current?.select();
					else setCode("");
					codeInputRef.current?.focus();
				} else {
					setTurnstileReset((value) => value + 1);
				}
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
			title={challengeToken ? "Two-step verification" : "Sign in"}
			description={
				challengeToken
					? useRecoveryCode
						? "Enter one of your saved recovery codes."
						: "Enter the code from your authenticator app."
					: undefined
			}
		>
			<form ref={formRef} method="post" onSubmit={onSubmit} className="space-y-5">
				{challengeToken && !useRecoveryCode && (
					<div className="flex flex-col items-center gap-3">
						<Label htmlFor="code" className="sr-only">
							Verification code
						</Label>
						<OneTimeCodeInput
							key="totp"
							id="code"
							inputRef={codeInputRef}
							value={code}
							onChange={(next) => {
								setCode(next);
								setError(null);
							}}
							onComplete={() => {
								if (!loading) formRef.current?.requestSubmit();
							}}
							disabled={loading}
							invalid={!!error}
							describedBy={error ? "login-error" : undefined}
						/>
					</div>
				)}
				{challengeToken && useRecoveryCode && (
					<div className="space-y-2">
						<Label htmlFor="code">Recovery code</Label>
						<Input
							key="recovery"
							ref={codeInputRef}
							id="code"
							name="code"
							type="text"
							inputMode="text"
							autoComplete="off"
							autoCapitalize="characters"
							spellCheck={false}
							required
							aria-invalid={!!error}
							aria-describedby={error ? "login-error" : undefined}
							placeholder="XXXX-XXXX-XXXX-XXXX"
							className="text-center font-mono tracking-wider"
						/>
					</div>
				)}
				{!challengeToken && (
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
									className="rounded-sm font-mono text-[0.6875rem] tracking-[0.14em] text-[#6c6353] uppercase transition-colors hover:text-[#8a4a11] focus-visible:ring-2 focus-visible:ring-[#8a4a11]"
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
						id="login-error"
						role="alert"
						className="border-l-2 border-[#b4331f] bg-[#faeae6] px-4 py-3 text-sm leading-5 text-[#8f2a19]"
					>
						{error}
					</p>
				)}
				<Button
					type="submit"
					className="h-11 w-full px-6 active:scale-[0.99]"
					disabled={loading || (!!challengeToken && !useRecoveryCode && code.length < 6)}
				>
					{loading ? "Checking…" : challengeToken ? "Verify" : "Sign in"}
				</Button>
				{challengeToken && (
					<div className="flex flex-col items-center gap-1 text-sm">
						<button
							type="button"
							className="rounded-sm px-2 py-1 font-medium text-[#8a4a11] hover:underline focus-visible:ring-2 focus-visible:ring-[#8a4a11]"
							onClick={() => {
								setUseRecoveryCode((value) => !value);
								setCode("");
								setError(null);
							}}
						>
							{useRecoveryCode ? "Use your authenticator app" : "Use a recovery code"}
						</button>
						<button
							type="button"
							className="rounded-sm px-2 py-1 text-[#6c6353] hover:text-[#2f2a23] focus-visible:ring-2 focus-visible:ring-[#8a4a11]"
							onClick={() => {
								setChallengeToken(null);
								setUseRecoveryCode(false);
								setCode("");
								setError(null);
								setTurnstileReset((value) => value + 1);
							}}
						>
							Use a different account
						</button>
					</div>
				)}
			</form>
		</AuthShell>
	);
}
