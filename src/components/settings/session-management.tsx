"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { RecentSignIn } from "./types";
import { loadSessionManagement, revokeOtherUserSessions } from "./utils";

export function SessionManagement() {
	const [activeCount, setActiveCount] = useState<number | null>(null);
	const [currentExpiry, setCurrentExpiry] = useState<string | null>(null);
	const [recentSignIns, setRecentSignIns] = useState<RecentSignIn[]>([]);
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void loadSessionManagement()
			.then((data) => {
				if (cancelled) return;
				setActiveCount(data.activeSessionCount);
				setCurrentExpiry(data.currentSession?.expiresAt ?? null);
				setRecentSignIns(data.recentSignIns);
			})
			.catch((error) => {
				if (!cancelled) setStatus(error instanceof Error ? error.message : "Failed to load sessions");
			});
		return () => { cancelled = true; };
	}, []);

	async function revokeOthers() {
		setBusy(true);
		setStatus(null);
		try {
			const revoked = await revokeOtherUserSessions();
			setActiveCount(1);
			setStatus(revoked === 0
				? "No other active sessions were found"
				: `${revoked} other ${revoked === 1 ? "session" : "sessions"} signed out`);
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Failed to revoke sessions");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="space-y-5">
			<div>
				<p className="text-sm font-medium text-neutral-900">
					{activeCount === null ? "Loading active sessions..." : `${activeCount} active ${activeCount === 1 ? "session" : "sessions"}`}
				</p>
				{currentExpiry && <p className="mt-1 text-xs text-neutral-500">This session expires {formatDate(currentExpiry)}.</p>}
			</div>
			<Button type="button" variant="outline" onClick={() => void revokeOthers()} disabled={busy || activeCount === null || activeCount <= 1}>
				{busy ? "Signing out..." : "Sign out other sessions"}
			</Button>
			{status && <p className="text-sm text-neutral-500" role="status">{status}</p>}
			<div className="space-y-3 border-t border-neutral-100 pt-5">
				<h3 className="text-sm font-medium text-neutral-900">Recent sign-ins</h3>
				{recentSignIns.length === 0 && <p className="text-sm text-neutral-500">No recent sign-ins recorded.</p>}
				{recentSignIns.map((signIn) => {
					const location = [signIn.city, signIn.country].filter(Boolean).join(", ");
					return (
						<div key={signIn.id} className="rounded-2xl border border-neutral-100 p-4 text-sm">
							<p className="font-medium text-neutral-900">{signIn.device} · {signIn.platform}</p>
							<p className="mt-1 text-neutral-500">{location || "Location unavailable"} · {signIn.ipAddress}</p>
							<p className="mt-1 text-xs text-neutral-400">{formatDate(signIn.createdAt)}</p>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function formatDate(value: string): string {
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
