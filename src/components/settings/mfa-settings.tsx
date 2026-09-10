"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authFetch } from "@/lib/auth/client";

type MfaStatus = { enabled: boolean; recoveryCodesRemaining: number };
type SetupDetails = { secret: string; otpauthUri: string };

export function MfaSettings() {
	const [status, setStatus] = useState<MfaStatus | null>(null);
	const [setup, setSetup] = useState<SetupDetails | null>(null);
	const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		void loadStatus().then(setStatus).catch((reason) => setError(errorMessage(reason)));
	}, []);

	async function beginSetup(form: FormData) {
		await run(async () => {
			const response = await requestJson<SetupDetails>("/api/settings/mfa", "POST", {
				currentPassword: form.get("currentPassword"),
			});
			setSetup(response);
			setRecoveryCodes([]);
			setMessage("Add the key to your authenticator, then enter its six-digit code.");
		});
	}

	async function confirmSetup(form: FormData) {
		await run(async () => {
			const response = await requestJson<{ recoveryCodes: string[] }>("/api/settings/mfa", "PUT", {
				code: form.get("code"),
			});
			setRecoveryCodes(response.recoveryCodes);
			setSetup(null);
			setStatus(await loadStatus());
			setMessage("Multi-factor authentication is enabled. Save every recovery code now; they will not be shown again.");
		});
	}

	async function protectedAction(form: FormData, method: "PATCH" | "DELETE") {
		await run(async () => {
			const response = await requestJson<{ recoveryCodes?: string[] }>("/api/settings/mfa", method, {
				currentPassword: form.get("currentPassword"),
				code: form.get("code"),
			});
			setRecoveryCodes(response.recoveryCodes ?? []);
			setStatus(await loadStatus());
			setMessage(method === "PATCH"
				? "New recovery codes created. Save them now; the previous codes no longer work."
				: "Multi-factor authentication is disabled.");
		});
	}

	async function run(action: () => Promise<void>) {
		setLoading(true);
		setError(null);
		setMessage(null);
		try {
			await action();
		} catch (reason) {
			setError(errorMessage(reason));
		} finally {
			setLoading(false);
		}
	}

	if (!status) return <p className="text-sm text-neutral-500">Loading security settings…</p>;

	return (
		<div className="space-y-6">
			<div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm">
				<p className="font-medium text-neutral-900">{status.enabled ? "Enabled" : "Not enabled"}</p>
				<p className="mt-1 text-neutral-600">
					{status.enabled
						? `${status.recoveryCodesRemaining} unused recovery codes remain.`
						: "Administrator sign-in currently relies on the password alone."}
				</p>
			</div>

			{!status.enabled && !setup && (
				<SecurityForm title="Enable multi-factor authentication" submitLabel="Create authenticator key" loading={loading} onSubmit={beginSetup} passwordOnly />
			)}

			{setup && (
				<div className="space-y-4 rounded-2xl border border-neutral-200 p-4">
					<div>
						<p className="text-sm font-medium text-neutral-900">Authenticator setup key</p>
						<code className="mt-2 block break-all rounded-xl bg-neutral-100 p-3 text-sm">{setup.secret}</code>
						<p className="mt-2 break-all text-xs text-neutral-500">{setup.otpauthUri}</p>
					</div>
					<form onSubmit={(event) => { event.preventDefault(); void confirmSetup(new FormData(event.currentTarget)); }} className="space-y-3">
						<CodeField />
						<Button type="submit" disabled={loading}>Verify and enable</Button>
					</form>
				</div>
			)}

			{status.enabled && (
				<>
					<SecurityForm title="Replace recovery codes" submitLabel="Generate new codes" loading={loading} onSubmit={(form) => protectedAction(form, "PATCH")} />
					<SecurityForm title="Disable multi-factor authentication" submitLabel="Disable MFA" loading={loading} onSubmit={(form) => protectedAction(form, "DELETE")} destructive />
				</>
			)}

			{recoveryCodes.length > 0 && (
				<div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
					<p className="text-sm font-medium text-amber-950">One-time recovery codes</p>
					<div className="mt-3 grid gap-2 font-mono text-sm sm:grid-cols-2">
						{recoveryCodes.map((code) => <code key={code}>{code}</code>)}
					</div>
					<Button type="button" variant="outline" className="mt-4" onClick={() => void navigator.clipboard.writeText(recoveryCodes.join("\n"))}>Copy codes</Button>
				</div>
			)}
			{message && <p className="text-sm font-medium text-emerald-700">{message}</p>}
			{error && <p className="text-sm font-medium text-red-700">{error}</p>}
		</div>
	);
}

function SecurityForm({
	title,
	submitLabel,
	loading,
	onSubmit,
	passwordOnly = false,
	destructive = false,
}: {
	title: string;
	submitLabel: string;
	loading: boolean;
	onSubmit: (form: FormData) => Promise<void>;
	passwordOnly?: boolean;
	destructive?: boolean;
}) {
	return (
		<form onSubmit={(event) => { event.preventDefault(); void onSubmit(new FormData(event.currentTarget)); }} className="space-y-3 rounded-2xl border border-neutral-200 p-4">
			<p className="text-sm font-medium text-neutral-900">{title}</p>
			<div className="space-y-2">
				<Label htmlFor={`${submitLabel}-password`}>Current password</Label>
				<Input id={`${submitLabel}-password`} name="currentPassword" type="password" autoComplete="current-password" required />
			</div>
			{!passwordOnly && <CodeField id={`${submitLabel}-code`} />}
			<Button type="submit" variant={destructive ? "destructive" : "default"} disabled={loading}>{submitLabel}</Button>
		</form>
	);
}

function CodeField({ id = "mfa-code" }: { id?: string }) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>Authenticator or recovery code</Label>
			<Input id={id} name="code" type="text" autoComplete="one-time-code" required />
		</div>
	);
}

async function loadStatus(): Promise<MfaStatus> {
	const response = await authFetch("/api/settings/mfa", { cache: "no-store" });
	const data = await response.json() as MfaStatus & { error?: string };
	if (!response.ok) throw new Error(data.error ?? "Failed to load multi-factor settings");
	return data;
}

async function requestJson<T = { ok: boolean }>(url: string, method: string, body: Record<string, unknown>): Promise<T> {
	const response = await authFetch(url, {
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const data = await response.json() as T & { error?: string };
	if (!response.ok) throw new Error(data.error ?? "Security request failed");
	return data;
}

function errorMessage(reason: unknown): string {
	return reason instanceof Error ? reason.message : "Security request failed";
}
