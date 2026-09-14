import type { CalendarView } from "@/components/calendar/calendar-types";
import { addLocalDays, monthGrid, startOfLocalDay, startOfWeek } from "@/lib/calendar/wall-clock";

export function visibleDays(view: CalendarView, anchor: Date): Date[] {
	if (view === "month") return monthGrid(anchor);
	if (view === "day") return [startOfLocalDay(anchor)];
	const start = startOfWeek(anchor);
	return Array.from({ length: 7 }, (_, index) => addLocalDays(start, index));
}

export function shiftAnchor(view: CalendarView, anchor: Date, direction: 1 | -1): Date {
	if (view === "month") return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
	return addLocalDays(anchor, direction * (view === "week" ? 7 : 1));
}

/**
 * Query bounds for the visible days. All-day items are stored at UTC midnight, so the
 * range is padded a day on each side to catch them in timezones far from UTC.
 */
export function queryRange(days: Date[]): { start: string; end: string } {
	return {
		start: addLocalDays(days[0], -1).toISOString(),
		end: addLocalDays(days[days.length - 1], 2).toISOString(),
	};
}

export function rangeTitle(view: CalendarView, days: Date[], anchor: Date): string {
	if (view === "month") {
		return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
	}
	if (view === "day") {
		return anchor.toLocaleDateString(undefined, {
			weekday: "long",
			month: "long",
			day: "numeric",
			year: "numeric",
		});
	}
	const first = days[0];
	const last = days[days.length - 1];
	if (first.getMonth() === last.getMonth()) {
		return first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
	}
	const sameYear = first.getFullYear() === last.getFullYear();
	return `${first.toLocaleDateString(undefined, {
		month: "short",
		year: sameYear ? undefined : "numeric",
	})} – ${last.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
}
