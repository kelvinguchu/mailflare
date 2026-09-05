"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, RefreshCw, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonRows } from "@/components/ui/skeleton";
import type { DeliveryFailure } from "./types";
import {
	fetchDeliveryFailures,
	formatDiagnosticCode,
	formatFailureDate,
	replayDeliveryFailure,
} from "./utils";

export default function DeliveryFailuresPage() {
	const queryClient = useQueryClient();
	const failures = useQuery({
		queryKey: ["delivery-failures"],
		queryFn: () => fetchDeliveryFailures(),
		refetchInterval: 30_000,
	});
	const replay = useMutation({
		mutationFn: replayDeliveryFailure,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["delivery-failures"] }),
	});
	const error = failures.error || replay.error;

	return (
		<div className="space-y-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-medium text-neutral-900">Delivery failures</h1>
					<p className="mt-1 text-sm text-neutral-500">
						Inspect mail that exhausted automatic queue retries. Message contents are never shown here.
					</p>
				</div>
				<Button type="button" variant="outline" onClick={() => void failures.refetch()} disabled={failures.isFetching}>
					<RefreshCw className={`h-4 w-4 ${failures.isFetching ? "animate-spin" : ""}`} />
					Refresh
				</Button>
			</div>

			{(failures.data?.unresolvedCount ?? 0) > 0 ? (
				<Card className="rounded-3xl border border-red-200 bg-red-50 p-6">
					<CardHeader className="flex-row items-center gap-3 space-y-0 py-0">
						<AlertTriangle className="h-5 w-5 text-red-700" />
						<CardTitle className="text-base text-red-950">
							{failures.data?.unresolvedCount} unresolved queue {failures.data?.unresolvedCount === 1 ? "failure" : "failures"}
						</CardTitle>
					</CardHeader>
				</Card>
			) : failures.data ? (
				<Card className="rounded-3xl border border-green-200 bg-green-50 p-6">
					<CardHeader className="flex-row items-center gap-3 space-y-0 py-0">
						<CheckCircle2 className="h-5 w-5 text-green-700" />
						<CardTitle className="text-base text-green-950">No unresolved queue failures</CardTitle>
					</CardHeader>
				</Card>
			) : null}

			{error && (
				<p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
					{error instanceof Error ? error.message : "Delivery failure operation failed"}
				</p>
			)}

			<section className="overflow-hidden rounded-3xl bg-white">
				<div className="border-b border-neutral-100 px-5 py-4">
					<h2 className="font-semibold text-neutral-900">Dead-letter history</h2>
					<p className="mt-1 text-xs text-neutral-500">
						Replay is audited. Outbound items with an uncertain provider outcome stay blocked to prevent duplicate mail.
					</p>
				</div>
				{failures.isLoading && <SkeletonRows count={5} />}
				{!failures.isLoading && (failures.data?.events ?? []).length === 0 && (
					<p className="px-5 py-8 text-sm text-neutral-500">No messages have reached a dead-letter queue.</p>
				)}
				<div className="divide-y divide-neutral-100">
					{(failures.data?.events ?? []).map((failure: DeliveryFailure) => (
						<div key={failure.id} className="grid gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
							<div className="min-w-0 space-y-1">
								<div className="flex flex-wrap items-center gap-2">
									<Badge variant="outline" className={failure.sourceQueue === "inbound" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-violet-200 bg-violet-50 text-violet-700"}>
										{failure.sourceQueue}
									</Badge>
									<Badge variant="outline" className={failure.status === "replayed" ? "border-green-200 bg-green-50 text-green-700" : failure.status === "replaying" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-red-200 bg-red-50 text-red-700"}>
										{failure.status}
									</Badge>
									<span className="text-xs capitalize text-neutral-600">{formatDiagnosticCode(failure.diagnosticCode)}</span>
								</div>
								<p className="truncate font-mono text-xs text-neutral-500" title={failure.referenceId ?? failure.id}>
									{failure.referenceId ?? failure.id}
								</p>
								<p className="text-xs text-neutral-500">
									Captured {formatFailureDate(failure.createdAt)} · Attempts recorded: {failure.attemptCount}
									{failure.replayedAt ? ` · Replayed ${formatFailureDate(failure.replayedAt)}` : ""}
								</p>
							</div>
							<Button
								type="button"
								variant="outline"
								disabled={failure.status !== "unresolved" || replay.isPending}
								onClick={() => replay.mutate(failure.id)}
							>
								<RotateCcw className="h-4 w-4" />
								{failure.status === "replayed" ? "Replayed" : failure.status === "replaying" ? "Replaying" : "Replay"}
							</Button>
						</div>
					))}
				</div>
			</section>
		</div>
	);
}
