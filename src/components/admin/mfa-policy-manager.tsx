"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authFetch } from "@/lib/auth/client";

type PolicyResponse = {
	policy: {
		mode: "optional" | "administrators" | "all_users";
		gracePeriodDays: number;
		updatedAt: string;
	};
	counts: { covered: number; compliant: number; grace: number; exempt: number; restricted: number };
};

export function MfaPolicyManager() {
	const [data, setData] = useState<PolicyResponse | null>(null);
	const [mode, setMode] = useState<PolicyResponse["policy"]["mode"]>("optional");
	const [gracePeriodDays, setGracePeriodDays] = useState(7);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	useEffect(() => {
		void loadPolicy()
			.then((response) => {
				setData(response);
				setMode(response.policy.mode);
				setGracePeriodDays(response.policy.gracePeriodDays);
			})
			.catch((error) => setMessage(errorMessage(error)));
	}, []);

	async function save() {
		setBusy(true);
		setMessage(null);
		try {
			const response = await authFetch("/api/admin/mfa-policy", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ mode, gracePeriodDays }),
			});
			const next = (await response.json()) as PolicyResponse & { error?: string };
			if (!response.ok) throw new Error(next.error ?? "Unable to update MFA policy");
			setData(next);
			setMessage("MFA policy updated. Existing covered accounts now use this grace period.");
		} catch (error) {
			setMessage(errorMessage(error));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="grid items-start gap-6 xl:grid-cols-2">
			<section className="space-y-5 rounded-3xl bg-white p-6">
				<div className="space-y-2">
					<Label htmlFor="mfa-policy-mode">Enforcement</Label>
					<select
						id="mfa-policy-mode"
						value={mode}
						onChange={(event) => setMode(event.target.value as typeof mode)}
						className="flex h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary/40"
					>
						<option value="optional">Optional for everyone</option>
						<option value="administrators">Required for administrators</option>
						<option value="all_users">Required for all users</option>
					</select>
				</div>
				<div className="space-y-2">
					<Label htmlFor="mfa-grace-days">Enrollment grace period (days)</Label>
					<Input
						id="mfa-grace-days"
						type="number"
						min={0}
						max={30}
						value={gracePeriodDays}
						onChange={(event) => setGracePeriodDays(Number(event.target.value))}
					/>
					<p className="text-xs leading-5 text-neutral-500">
						Covered users may sign in normally until their deadline. Afterward, they can only enroll
						MFA, recover the account, or sign out.
					</p>
				</div>
				<Button type="button" onClick={() => void save()} disabled={busy}>
					{busy ? "Saving…" : "Save MFA policy"}
				</Button>
			</section>

			{data && (
				<section className="rounded-3xl bg-white p-6">
					<h2 className="text-lg font-semibold text-neutral-900">Coverage</h2>
					<dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{Object.entries(data.counts).map(([label, count]) => (
							<div key={label} className="rounded-2xl bg-neutral-50 p-4">
								<dt className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
									{label}
								</dt>
								<dd className="mt-1 text-2xl font-semibold text-neutral-900">{count}</dd>
							</div>
						))}
					</dl>
				</section>
			)}
			{message && (
				<p role="status" className="text-sm text-neutral-700 xl:col-span-2">
					{message}
				</p>
			)}
		</div>
	);
}

async function loadPolicy(): Promise<PolicyResponse> {
	const response = await authFetch("/api/admin/mfa-policy", { cache: "no-store" });
	const data = (await response.json()) as PolicyResponse & { error?: string };
	if (!response.ok) throw new Error(data.error ?? "Unable to load MFA policy");
	return data;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "MFA policy request failed";
}
