"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { authFetch } from "@/lib/auth/client";

async function fetchUnresolvedFailureCount(): Promise<number> {
	const response = await authFetch("/api/admin/dead-letters?limit=1");
	if (!response.ok) return 0;
	const data = (await response.json()) as { unresolvedCount?: number };
	return data.unresolvedCount ?? 0;
}

export function DeadLetterAlert() {
	const count = useQuery({
		queryKey: ["delivery-failures", "unresolved-count"],
		queryFn: fetchUnresolvedFailureCount,
		refetchInterval: 60_000,
	});
	if (!count.data) return null;

	return (
		<Link
			href="/delivery-failures"
			className="mb-6 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 transition-colors hover:bg-red-100"
		>
			<AlertTriangle className="h-5 w-5 shrink-0 text-red-700" />
			<span className="font-medium">
				{count.data} mail {count.data === 1 ? "delivery has" : "deliveries have"} exhausted automatic retries
			</span>
			<ArrowRight className="ml-auto h-4 w-4" />
		</Link>
	);
}
