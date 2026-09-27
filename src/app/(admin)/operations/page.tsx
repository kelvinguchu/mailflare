"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentAccount } from "@/hooks/use-current-account";
import { cn } from "@/lib/utils";
import { KpiStrip, ProcessingPanel, RecoveryStoragePanel, StatusBanner } from "./HealthOverview";
import { ThresholdSettings } from "./ThresholdSettings";
import {
	OPERATIONS_QUERY_KEY,
	REFRESH_INTERVAL_MS,
	captureStorageSnapshot,
	describeOperationsError,
	fetchOperationalHealth,
	formatDateTime,
	formatRelative,
} from "./utils";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

/** Re-renders relative times ("2 minutes ago") without refetching. */
function useNow(intervalMs = 15_000): Date {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(new Date()), intervalMs);
		return () => window.clearInterval(timer);
	}, [intervalMs]);
	return now;
}

export default function OperationsPage() {
	const queryClient = useQueryClient();
	const now = useNow();
	const account = useCurrentAccount();
	const health = useQuery({
		queryKey: OPERATIONS_QUERY_KEY,
		queryFn: fetchOperationalHealth,
		refetchInterval: REFRESH_INTERVAL_MS,
		refetchIntervalInBackground: false,
		retry: 1,
	});
	const snapshot = useMutation({
		mutationFn: captureStorageSnapshot,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: OPERATIONS_QUERY_KEY }),
	});

	const data = health.data;
	const measureError = snapshot.error
		? describeOperationsError(snapshot.error, "measure storage")
		: null;

	return (
		<div className="space-y-4 pb-10">
			<AdminPageHeader
				title="Operations"
				actions={
					<>
						<div className="flex items-center gap-3">
							{data && (
								<p
									className="text-xs text-neutral-500"
									title={formatDateTime(data.generatedAt)}
									aria-live="polite"
								>
									Checked {formatRelative(data.generatedAt, now)}
									<span className="hidden sm:inline"> · refreshes every 30 seconds</span>
								</p>
							)}
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={health.isFetching}
								onClick={() => void health.refetch()}
							>
								<RefreshCw
									className={cn(health.isFetching && "animate-spin motion-reduce:animate-none")}
								/>
								{health.isFetching ? "Checking…" : "Refresh"}
							</Button>
						</div>
					</>
				}
			/>

			{health.isError && data && (
				<div
					role="status"
					className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900"
				>
					<AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
					<span className="min-w-0 flex-1">
						{describeOperationsError(health.error, "refresh operational health")} Showing results
						from {formatDateTime(data.generatedAt)}.
					</span>
				</div>
			)}

			{health.isPending && <OperationsSkeleton />}

			{health.isError && !data && (
				<div
					role="alert"
					className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-16 text-center"
				>
					<AlertTriangle className="size-6 text-red-500" aria-hidden="true" />
					<p className="max-w-md text-sm text-neutral-700">
						{describeOperationsError(health.error, "load operational health")}
					</p>
					<Button type="button" variant="outline" size="sm" onClick={() => void health.refetch()}>
						Try again
					</Button>
				</div>
			)}

			{data && (
				<>
					<StatusBanner
						health={data}
						measuring={snapshot.isPending}
						onMeasure={() => snapshot.mutate()}
					/>
					<KpiStrip health={data} now={now} />
					<div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(22rem,1fr)]">
						<ProcessingPanel health={data} now={now} />
						<RecoveryStoragePanel
							health={data}
							now={now}
							measuring={snapshot.isPending}
							measureError={measureError}
							onMeasure={() => snapshot.mutate()}
						/>
					</div>
					<ThresholdSettings health={data} mfaEnabled={account.data?.mfaEnabled ?? false} />
				</>
			)}
		</div>
	);
}

function OperationsSkeleton() {
	return (
		<div className="space-y-4" role="status" aria-label="Loading operational health">
			<Skeleton className="h-12 rounded-2xl" />
			<div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl md:grid-cols-3 2xl:grid-cols-6">
				{Array.from({ length: 6 }, (_, index) => (
					<div key={index} className="space-y-2 bg-white px-5 py-4">
						<Skeleton className="h-3 w-24" />
						<Skeleton className="h-7 w-16" />
						<Skeleton className="h-3 w-20" />
					</div>
				))}
			</div>
			<div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(22rem,1fr)]">
				<Skeleton className="h-96 rounded-2xl" />
				<Skeleton className="h-96 rounded-2xl" />
			</div>
		</div>
	);
}
