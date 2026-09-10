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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
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
      title="Sign in"
      description={challengeToken
        ? "Enter the code from your authenticator app or use a recovery code."
        : "Open your mailbox and continue from the same inbox workspace."}
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
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </div>
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-3">
				<Label htmlFor="password">Password</Label>
				<Link href="/forgot-password" className="text-sm font-medium text-neutral-600 hover:text-neutral-900">
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
          <p className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="h-11 w-full rounded-full px-6 active:scale-[0.98]"
          disabled={loading}
        >
          {loading ? "Checking..." : challengeToken ? "Verify and sign in" : "Sign in"}
        </Button>
        {challengeToken && (
          <Button
            type="button"
            variant="ghost"
            className="w-full rounded-full"
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
