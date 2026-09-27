"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/auth/client";

type Notice = { state?: string; deadline?: string | null };

export function MfaPolicyNotice() {
	const [policy, setPolicy] = useState<Notice | null>(null);
	useEffect(() => {
		let cancelled = false;
		void authFetch("/api/auth/me", { cache: "no-store", redirectOnUnauthorized: false })
			.then(async (response) =>
				response.ok ? ((await response.json()) as { mfaPolicy?: Notice }) : null,
			)
			.then((data) => {
				if (!cancelled) setPolicy(data?.mfaPolicy ?? null);
			})
			.catch(() => {
				if (!cancelled) setPolicy(null);
			});
		return () => {
			cancelled = true;
		};
	}, []);
	if (policy?.state !== "grace" || !policy.deadline) return null;
	return (
		<div
			role="status"
			className="flex flex-wrap items-center justify-between gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-950"
		>
			<span>
				MFA enrollment is required by{" "}
				{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
					new Date(policy.deadline),
				)}
				.
			</span>
			<Link className="font-semibold underline underline-offset-4" href="/enroll-mfa">
				Enroll now
			</Link>
		</div>
	);
}
