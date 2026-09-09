"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authFetch } from "@/lib/auth/client";
import type { ProfileFormProps, ProfileFormResponse } from "./types";

export function ProfileForm({
	initialName,
	initialResetEmail,
	initialResetEmailVerified,
	email,
}: ProfileFormProps) {
	const [name, setName] = useState(initialName);
	const [resetEmail, setResetEmail] = useState(initialResetEmail);
	const [savedName, setSavedName] = useState(initialName);
	const [savedResetEmail, setSavedResetEmail] = useState(initialResetEmail);
	const [resetEmailVerified, setResetEmailVerified] = useState(initialResetEmailVerified);
	const [status, setStatus] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [verificationLoading, setVerificationLoading] = useState(false);
	const hasChanges =
		name.trim() !== savedName ||
		resetEmail.trim() !== savedResetEmail;
	const canVerify = !!savedResetEmail && !resetEmailVerified && !hasChanges;

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setLoading(true);
		setStatus(null);

		try {
			const res = await authFetch("/api/settings/profile", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name, resetEmail }),
			});
			const data = (await res.json()) as ProfileFormResponse;

			if (!res.ok) {
				setStatus(typeof data.error === "string" ? data.error : "Failed to update account");
				return;
			}

			const nextName = data.user?.name ?? name.trim();
			const nextResetEmail = data.user?.resetEmail ?? "";
			setName(nextName);
			setResetEmail(nextResetEmail);
			setSavedName(nextName);
			setSavedResetEmail(nextResetEmail);
			setResetEmailVerified(data.user?.resetEmailVerified ?? false);
			setStatus(
				nextResetEmail && !data.user?.resetEmailVerified
					? "Saved. Verify this address before it can be used for password recovery."
					: "Saved",
			);
		} catch (err) {
			setStatus(err instanceof Error ? err.message : "Failed to update account");
		} finally {
			setLoading(false);
		}
	}

	async function sendVerification() {
		setVerificationLoading(true);
		setStatus(null);
		try {
			const res = await authFetch("/api/settings/recovery-email/verification", { method: "POST" });
			const data = (await res.json()) as { error?: string; verified?: boolean };
			if (!res.ok) throw new Error(data.error ?? "Failed to send verification email");
			if (data.verified) {
				setResetEmailVerified(true);
				setStatus("Recovery email is verified.");
			} else {
				setStatus("Verification email sent. The link expires in 24 hours.");
			}
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Failed to send verification email");
		} finally {
			setVerificationLoading(false);
		}
	}

	return (
		<form onSubmit={onSubmit} className="space-y-4">
			<div className="space-y-2">
				<Label htmlFor="accountEmail">Current email</Label>
				<Input id="accountEmail" value={email} type="email" readOnly aria-readonly="true" className="bg-neutral-50" />
			</div>
			<div className="space-y-2">
				<Label htmlFor="name">Name</Label>
				<Input id="name" value={name} onChange={(event) => setName(event.target.value)} required />
			</div>
			<div className="space-y-2">
				<div className="flex items-center justify-between gap-3">
					<Label htmlFor="resetEmail">Recovery email</Label>
					{savedResetEmail && !hasChanges && (
						<span className={`text-xs font-medium ${resetEmailVerified ? "text-emerald-700" : "text-amber-700"}`}>
							{resetEmailVerified ? "Verified" : "Not verified"}
						</span>
					)}
				</div>
				<Input
					id="resetEmail"
					value={resetEmail}
					onChange={(event) => setResetEmail(event.target.value)}
					type="email"
					placeholder="recovery@example.com"
				/>
			</div>
			<div className="flex items-center gap-3">
				<Button type="submit" disabled={loading || !hasChanges}>
					{loading ? "Saving..." : "Save"}
				</Button>
				{canVerify && (
					<Button
						type="button"
						variant="outline"
						disabled={verificationLoading}
						onClick={sendVerification}
					>
						{verificationLoading ? "Sending..." : "Send verification"}
					</Button>
				)}
				{status && <p className="text-sm text-neutral-500">{status}</p>}
			</div>
		</form>
	);
}
