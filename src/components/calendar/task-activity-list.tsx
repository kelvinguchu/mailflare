"use client";

import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { calendarKeys, listCalendarTaskActivity } from "@/lib/calendar/client";
import { browserTimezone } from "@/lib/calendar/wall-clock";
import {
	describeTaskActivity,
	formatExactTime,
	formatRelativeTime,
	groupTaskActivityByDay,
} from "./task-activity-utils";

const ACTIVITY_PREVIEW = 5;

/** The current time, refreshed each minute so "just now" ages while the dialog is open. */
function useNow(intervalMs = 60_000): Date {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(new Date()), intervalMs);
		return () => window.clearInterval(timer);
	}, [intervalMs]);
	return now;
}

/** A task's history, newest first and grouped by day, each entry a readable sentence. */
export function TaskActivityList({
	taskId,
	accountId,
}: Readonly<{ taskId: string; accountId: string | undefined }>) {
	const headingId = useId();
	const listId = useId();
	const [expanded, setExpanded] = useState(false);
	const now = useNow();
	const activity = useQuery({
		queryKey: calendarKeys.activity(taskId),
		queryFn: () => listCalendarTaskActivity(taskId),
	});
	const items = activity.data ?? [];
	const visible = expanded ? items : items.slice(0, ACTIVITY_PREVIEW);
	const days = groupTaskActivityByDay(visible, now);
	const viewer = { accountId, timezone: browserTimezone(), now };

	return (
		<section aria-labelledby={headingId} className="space-y-2">
			<h3 id={headingId} className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
				Activity
			</h3>
			{activity.isPending && (
				<div className="space-y-2" role="status" aria-label="Loading activity">
					<Skeleton className="h-3.5 w-2/3" />
					<Skeleton className="h-3.5 w-1/2" />
				</div>
			)}
			{activity.isError && (
				<p className="text-sm text-neutral-500">
					Activity couldn’t be loaded.{" "}
					<button
						type="button"
						className="font-medium text-primary hover:underline"
						onClick={() => void activity.refetch()}
					>
						Try again
					</button>
				</p>
			)}
			{activity.isSuccess && items.length === 0 && (
				<p className="text-sm text-neutral-500">No activity recorded yet.</p>
			)}
			{days.length > 0 && (
				<div id={listId} className="space-y-3">
					{days.map((day) => {
						const dayHeadingId = `${headingId}-${day.key}`;
						return (
							<div key={day.key}>
								<h4 id={dayHeadingId} className="mb-1 text-xs font-medium text-neutral-400">
									{day.label}
								</h4>
								<ol aria-labelledby={dayHeadingId} className="space-y-2">
									{day.items.map((item) => {
										const { actor, text, changes } = describeTaskActivity(item, viewer);
										return (
											<li
												key={item.id}
												className="flex items-baseline gap-3 text-sm max-sm:flex-col max-sm:gap-0.5"
											>
												<div className="min-w-0 flex-1 wrap-break-word text-neutral-700">
													<p>
														<span className="font-medium text-neutral-900">{actor}</span> {text}
													</p>
													{changes.length > 0 && (
														<ul className="mt-1 list-disc space-y-0.5 pl-5 text-neutral-600 marker:text-neutral-300">
															{changes.map((change, index) => (
																<li key={index}>{change}</li>
															))}
														</ul>
													)}
												</div>
												<time
													dateTime={item.createdAt}
													title={formatExactTime(item.createdAt)}
													className="shrink-0 text-xs text-neutral-400"
												>
													{formatRelativeTime(item.createdAt, now)}
												</time>
											</li>
										);
									})}
								</ol>
							</div>
						);
					})}
				</div>
			)}
			{items.length > ACTIVITY_PREVIEW && (
				<button
					type="button"
					aria-expanded={expanded}
					aria-controls={listId}
					className="text-xs font-medium text-primary hover:underline"
					onClick={() => setExpanded((current) => !current)}
				>
					{expanded ? "Show less" : `Show all ${items.length}`}
				</button>
			)}
		</section>
	);
}
