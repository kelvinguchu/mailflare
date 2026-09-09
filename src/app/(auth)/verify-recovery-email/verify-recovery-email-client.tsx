"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";

export function VerifyRecoveryEmailClient({ token }: { token: string }) {
	const [verified, setVerified] = useState(false);
	const [error, setError] = useState<string | null>(token ? null : "This verification link is invalid.");
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (token) window.history.replaceState({}, "", "/verify-recovery-email");
	}, [token]);

	async function verify() {
		setLoading(true);
		setError(null);
		try {
			const response = await fetch("/api/auth/recovery-email/verify", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				signal: AbortSignal.timeout(20_000),
				body: JSON.stringify({ token }),
			});
			const data = (await response.json()) as { error?: string };
			if (!response.ok) throw new Error(data.error ?? "Unable to verify recovery email");
			setVerified(true);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Unable to verify recovery email");
		} finally {
			setLoading(false);
		}
	}

	return (
		<AuthShell
			icon={ShieldCheck}
			title="Verify recovery email"
			description="Confirm this address before CC Mail can use it for password recovery."
		>
			<div className="space-y-5">
				{verified ? (
					<p className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
						Recovery email verified.
					</p>
				) : (
					<>
						{error && (
							<p className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
								{error}
							</p>
						)}
						<Button type="button" className="h-11 w-full rounded-full" disabled={loading || !token} onClick={verify}>
							{loading ? "Verifying..." : "Verify recovery email"}
						</Button>
					</>
				)}
				<p className="text-center text-sm text-neutral-500">
					<Link href="/login" className="font-medium text-neutral-800 hover:text-neutral-950">
						Continue to sign in
					</Link>
				</p>
			</div>
		</AuthShell>
	);
}
