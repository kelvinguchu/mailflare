"use client";

import { useQuery } from "@tanstack/react-query";
import { LogIn, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchActivity, formatActivityDate, getActivityLabel, getActivityMetadata } from "./utils";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

export default function ActivityPage() {
	const activity = useQuery({
		queryKey: ["activity"],
		queryFn: fetchActivity,
	});

	return (
		<div className="space-y-6">
			<AdminPageHeader title="Activity" />

			<ul className="space-y-2 md:hidden" aria-label="Activity">
				{activity.isLoading &&
					Array.from({ length: 5 }, (_, index) => (
						<li key={index} className="space-y-2 rounded-xl border bg-white p-3.5">
							<Skeleton className="h-4 w-48" />
							<Skeleton className="h-3 w-32" />
						</li>
					))}
				{!activity.isLoading && (activity.data ?? []).length === 0 && (
					<li className="rounded-xl border bg-white p-3.5 text-sm text-neutral-500">
						No login or logout activity yet
					</li>
				)}
				{(activity.data ?? []).map((log) => {
					const metadata = getActivityMetadata(log);
					const Icon = log.action === "auth.logout" ? LogOut : LogIn;
					return (
						<li key={log.id} className="rounded-xl border bg-white p-3.5">
							<div className="flex items-start justify-between gap-3">
								<p className="min-w-0 truncate text-sm font-medium text-neutral-900 no-font-mono">
									{log.actorEmail ?? "(unknown email)"}
								</p>
								<Badge variant="outline" className="shrink-0 gap-1">
									<Icon className="h-3 w-3" />
									{getActivityLabel(log.action)}
								</Badge>
							</div>
							<p className="mt-1 text-xs text-neutral-500">{formatActivityDate(log.createdAt)}</p>
							<div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">
								<span>
									{metadata.city || "(unknown city)"} • {metadata.country || "(unknown country)"}
								</span>
								<span className="max-w-full truncate">{metadata.device ?? "(unknown device)"}</span>
								<span className="min-w-0 wrap-anywhere">
									{metadata.platform || "(unknown platform)"} •{" "}
									{metadata.ipAddress ?? "(unknown IP)"}
								</span>
							</div>
						</li>
					);
				})}
			</ul>

			<section className="hidden overflow-x-auto rounded-3xl bg-white md:block">
				<table className="w-full min-w-[760px] table-fixed text-left">
					<thead className="border-b border-neutral-100 bg-neutral-50 text-xs font-semibold uppercase tracking-wide text-neutral-500">
						<tr>
							<th className="w-32 px-5 py-3">Activity</th>
							<th className="px-5 py-3">User</th>
							<th className="w-64 px-5 py-3">Device</th>
							<th className="w-48 px-5 py-3">Time</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-neutral-100">
						{activity.isLoading &&
							Array.from({ length: 7 }, (_, index) => (
								<tr key={index}>
									<td className="px-5 py-4">
										<Skeleton className="h-6 w-20" />
									</td>
									<td className="px-5 py-4">
										<Skeleton className="h-9 w-48" />
									</td>
									<td className="px-5 py-4">
										<Skeleton className="h-9 w-40" />
									</td>
									<td className="px-5 py-4">
										<Skeleton className="h-4 w-32" />
									</td>
								</tr>
							))}
						{!activity.isLoading && (activity.data ?? []).length === 0 && (
							<tr>
								<td colSpan={4} className="px-5 py-4 text-sm text-neutral-500">
									No login or logout activity yet
								</td>
							</tr>
						)}
						{(activity.data ?? []).map((log) => {
							const metadata = getActivityMetadata(log);
							const Icon = log.action === "auth.logout" ? LogOut : LogIn;
							return (
								<tr key={log.id} className="align-top hover:bg-neutral-50/70">
									<td className="px-5 py-4">
										<Badge variant="outline" className="gap-1">
											<Icon className="h-3 w-3" />
											{getActivityLabel(log.action)}
										</Badge>
									</td>
									<td className="px-5 py-4">
										<p className="flex flex-col truncate no-font-mono">
											<span>{log.actorEmail ?? "(unknown email)"}</span>
										</p>
										<small className="text-neutral-500">
											{metadata.city || "(unknown city)"} •{" "}
											{metadata.country || "(unknown country)"}
										</small>
									</td>
									<td className="px-5 py-4">
										<p className="flex flex-col truncate no-font-mono">
											{metadata.device ?? "(unknown device)"}
										</p>

										<small className="text-neutral-500">
											{metadata.platform || "(unknown platform)"} •{" "}
											{metadata.ipAddress ?? "(unknown IP)"}
										</small>
									</td>
									<td className="px-5 py-4 text-sm text-neutral-500">
										{formatActivityDate(log.createdAt)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</section>
		</div>
	);
}
