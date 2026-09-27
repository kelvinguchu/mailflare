"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authFetch } from "@/lib/auth/client";
import type { ManagedAccount } from "@/app/(admin)/accounts/[id]/types";

export function AccountMfaPolicy({
	account,
	onRefresh,
}: {
	account: ManagedAccount;
	onRefresh: () => Promise<void>;
}) {
	const [exemptUntil, setExemptUntil] = useState("");
	const [reason, setReason] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const activeException = account.mfaPolicyExceptionActive;

	async function request(path: string, method: string, body?: unknown) {
		setBusy(true);
		setMessage(null);
		try {
			const response = await authFetch(path, {
				method,
				headers: body ? { "Content-Type": "application/json" } : undefined,
				body: body ? JSON.stringify(body) : undefined,
			});
			const data = (await response.json()) as { error?: string };
			if (!response.ok) throw new Error(data.error ?? "Security request failed");
			await onRefresh();
			setMessage("Account MFA policy updated.");
			setConfirmation("");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Security request failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="space-y-5 rounded-3xl bg-white p-6">
			<div>
				<h2 className="text-lg font-semibold text-neutral-900">Multi-factor policy</h2>
				<p className="mt-1 text-sm text-neutral-500">
					MFA is {account.mfaEnabled ? "enabled" : "not enabled"} for this account.
				</p>
			</div>
			{activeException ? (
				<div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
					<p>
						Exception expires{" "}
						{new Intl.DateTimeFormat(undefined, {
							dateStyle: "medium",
							timeStyle: "short",
						}).format(new Date(account.mfaPolicyExemptUntil!))}
						.
					</p>
					<p className="mt-1">Reason: {account.mfaPolicyExemptionReason}</p>
					<Button
						type="button"
						variant="outline"
						className="mt-3"
						disabled={busy}
						onClick={() => void request(`/api/accounts/${account.id}/mfa-policy`, "DELETE")}
					>
						Revoke exception
					</Button>
				</div>
			) : (
				<div className="space-y-3 rounded-2xl border border-neutral-200 p-4">
					<p className="text-sm font-medium text-neutral-900">Temporary exception</p>
					<div className="space-y-2">
						<Label htmlFor="mfa-exempt-until">Expires</Label>
						<Input
							id="mfa-exempt-until"
							type="datetime-local"
							value={exemptUntil}
							onChange={(event) => setExemptUntil(event.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="mfa-exemption-reason">Reason</Label>
						<Input
							id="mfa-exemption-reason"
							value={reason}
							maxLength={500}
							onChange={(event) => setReason(event.target.value)}
						/>
					</div>
					<Button
						type="button"
						variant="outline"
						disabled={busy || !exemptUntil || reason.trim().length < 3}
						onClick={() =>
							void request(`/api/accounts/${account.id}/mfa-policy`, "PATCH", {
								exemptUntil: new Date(exemptUntil).toISOString(),
								reason,
							})
						}
					>
						Grant exception
					</Button>
				</div>
			)}

			{account.mfaEnabled && (
				<div className="space-y-3 rounded-2xl border border-red-100 p-4">
					<p className="text-sm text-neutral-600">
						Reset a lost authenticator and recovery codes. All of this user&apos;s sessions will be
						revoked and their enrollment grace period restarts.
					</p>
					<Label htmlFor="mfa-reset-confirmation">
						Type <span className="font-mono">reset mfa {account.email}</span>
					</Label>
					<Input
						id="mfa-reset-confirmation"
						value={confirmation}
						onChange={(event) => setConfirmation(event.target.value)}
					/>
					<Button
						type="button"
						variant="destructive"
						disabled={busy || confirmation !== `reset mfa ${account.email}`}
						onClick={() =>
							void request(`/api/accounts/${account.id}/mfa-reset`, "POST", { confirmation })
						}
					>
						Reset MFA and sessions
					</Button>
				</div>
			)}
			{message && (
				<p role="status" className="text-sm text-neutral-700">
					{message}
				</p>
			)}
		</section>
	);
}
