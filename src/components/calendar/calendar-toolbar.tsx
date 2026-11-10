"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { rangeTitle, shiftAnchor } from "@/app/(dashboard)/calendar/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { startOfLocalDay } from "@/lib/calendar/wall-clock";
import { cn } from "@/lib/utils";
import type { CalendarView } from "./calendar-types";

export const CALENDAR_VIEWS: Array<{ value: CalendarView; label: string; shortcut: string }> = [
	{ value: "month", label: "Month", shortcut: "m" },
	{ value: "week", label: "Week", shortcut: "w" },
	{ value: "day", label: "Day", shortcut: "d" },
];

/** Today, previous and next, and the visible range's title. */
export function CalendarRangeNav({
	view,
	days,
	anchor,
	onAnchorChange,
	busy,
}: Readonly<{
	view: CalendarView;
	days: Date[];
	anchor: Date;
	onAnchorChange: Dispatch<SetStateAction<Date>>;
	busy: boolean;
}>) {
	return (
		<>
			<div className="flex items-center gap-1">
				<Button
					variant="outline"
					size="sm"
					className="rounded-full px-4 max-sm:px-3"
					onClick={() => onAnchorChange(startOfLocalDay(new Date()))}
					title="Today (T)"
				>
					Today
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					className="rounded-full"
					aria-label={`Previous ${view}`}
					onClick={() => onAnchorChange((current) => shiftAnchor(view, current, -1))}
				>
					<ChevronLeft />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					className="rounded-full"
					aria-label={`Next ${view}`}
					onClick={() => onAnchorChange((current) => shiftAnchor(view, current, 1))}
				>
					<ChevronRight />
				</Button>
			</div>
			<h2 className="text-lg text-neutral-800 max-sm:text-base" aria-live="polite">
				{rangeTitle(view, days, anchor)}
			</h2>
			{busy && (
				<span role="status" className="inline-flex items-center gap-2 text-sm text-neutral-500">
					<Spinner aria-hidden="true" className="text-neutral-400" />
					<span className="sr-only">Updating calendar…</span>
				</span>
			)}
		</>
	);
}

export function CalendarViewSwitch({
	view,
	onViewChange,
}: Readonly<{ view: CalendarView; onViewChange: (view: CalendarView) => void }>) {
	return (
		<div
			className="flex rounded-full bg-neutral-100 p-0.5"
			role="radiogroup"
			aria-label="Calendar view"
		>
			{CALENDAR_VIEWS.map((item) => (
				<button
					key={item.value}
					type="button"
					role="radio"
					aria-checked={view === item.value}
					title={`${item.label} (${item.shortcut.toUpperCase()})`}
					onClick={() => onViewChange(item.value)}
					className={cn(
						"rounded-full px-3 py-1 text-sm font-medium transition-colors max-sm:px-2.5",
						view === item.value
							? "bg-white text-neutral-900 shadow-sm"
							: "text-neutral-500 hover:text-neutral-800",
					)}
				>
					{item.label}
				</button>
			))}
		</div>
	);
}

/** M/W/D switch views, T jumps to today, arrows or J/K move, and C runs `onCreate`. */
export function useCalendarShortcuts({
	disabled,
	view,
	onViewChange,
	onAnchorChange,
	onCreate,
}: {
	disabled: boolean;
	view: CalendarView;
	onViewChange: (view: CalendarView) => void;
	onAnchorChange: Dispatch<SetStateAction<Date>>;
	onCreate?: () => void;
}) {
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (disabled || event.metaKey || event.ctrlKey || event.altKey) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest("input, textarea, select, [contenteditable=true], [role=combobox]"))
				return;
			const key = event.key.toLowerCase();
			const nextView = CALENDAR_VIEWS.find((item) => item.shortcut === key)?.value;
			if (nextView) onViewChange(nextView);
			else if (key === "t") onAnchorChange(startOfLocalDay(new Date()));
			else if (key === "arrowleft" || key === "k")
				onAnchorChange((current) => shiftAnchor(view, current, -1));
			else if (key === "arrowright" || key === "j")
				onAnchorChange((current) => shiftAnchor(view, current, 1));
			else if (key === "c" && onCreate) onCreate();
			else return;
			event.preventDefault();
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	});
}
