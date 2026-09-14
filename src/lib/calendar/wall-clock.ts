/**
 * Browser-side time helpers for the calendar UI.
 *
 * The API stores timed values as UTC instants plus an IANA timezone, and all-day
 * values as UTC midnight with an exclusive end date. Grids render in the viewer's
 * own timezone, while forms edit wall-clock values in the item's timezone.
 */

export const MINUTES_PER_DAY = 24 * 60;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
	let formatter = formatterCache.get(timeZone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		formatterCache.set(timeZone, formatter);
	}
	return formatter;
}

function wallClockParts(instant: Date, timeZone: string) {
	const values: Record<string, number> = {};
	for (const part of partsFormatter(timeZone).formatToParts(instant)) {
		if (part.type !== "literal") values[part.type] = Number(part.value);
	}
	return {
		year: values.year,
		month: values.month,
		day: values.day,
		hour: values.hour,
		minute: values.minute,
		second: values.second,
	};
}

function pad(value: number, length = 2): string {
	return String(Math.abs(value)).padStart(length, "0");
}

export function browserTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function supportedTimezones(include: string[] = []): string[] {
	let zones: string[] = [];
	try {
		zones = Intl.supportedValuesOf("timeZone");
	} catch {
		zones = [];
	}
	return [...new Set(["UTC", ...zones, ...include.filter(Boolean)])].sort((a, b) =>
		a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b),
	);
}

/** Minutes the timezone's wall clock is ahead of UTC at the given instant. */
export function timezoneOffsetMinutes(instant: Date, timeZone: string): number {
	const parts = wallClockParts(instant, timeZone);
	const asUtc = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second,
	);
	const wholeSeconds = Math.floor(instant.getTime() / 1_000) * 1_000;
	return Math.round((asUtc - wholeSeconds) / 60_000);
}

/** Interprets a `YYYY-MM-DDTHH:mm` wall-clock value in an IANA timezone. */
export function wallClockToInstant(value: string, timeZone: string): Date {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
	if (!match) throw new Error("Enter a valid date and time");
	const [, year, month, day, hour, minute] = match.map(Number);
	const guess = Date.UTC(year, month - 1, day, hour, minute);
	let instant = guess - timezoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
	const corrected = guess - timezoneOffsetMinutes(new Date(instant), timeZone) * 60_000;
	if (corrected !== instant) instant = corrected;
	return new Date(instant);
}

/** Formats an instant as a `YYYY-MM-DDTHH:mm` wall-clock value in an IANA timezone. */
export function instantToWallClock(instant: Date | string, timeZone: string): string {
	const parts = wallClockParts(new Date(instant), timeZone);
	return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Formats an instant with the timezone's numeric offset, as the API requires. */
export function toOffsetDateTime(instant: Date, timeZone: string): string {
	const offset = timezoneOffsetMinutes(instant, timeZone);
	const sign = offset < 0 ? "-" : "+";
	const parts = wallClockParts(instant, timeZone);
	return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

/** Calendar date in the viewer's local timezone. */
export function dateKey(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Calendar date of an all-day value, which the API stores at UTC midnight. */
export function utcDateKey(value: Date | string): string {
	const date = new Date(value);
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDaysToKey(key: string, days: number): string {
	const [year, month, day] = key.split("-").map(Number);
	return utcDateKey(new Date(Date.UTC(year, month - 1, day + days)));
}

export function keyToLocalDate(key: string): Date {
	const [year, month, day] = key.split("-").map(Number);
	return new Date(year, month - 1, day);
}

export function startOfLocalDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addLocalDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function startOfWeek(date: Date, weekStartsOn = 0): Date {
	const day = startOfLocalDay(date);
	return addLocalDays(day, -((day.getDay() - weekStartsOn + 7) % 7));
}

/** Whole weeks covering the anchor's month, starting on `weekStartsOn`. */
export function monthGrid(anchor: Date, weekStartsOn = 0): Date[] {
	const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
	const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
	const start = startOfWeek(first, weekStartsOn);
	const end = addLocalDays(startOfWeek(last, weekStartsOn), 7);
	const days: Date[] = [];
	for (let day = start; day < end; day = addLocalDays(day, 1)) days.push(day);
	return days;
}

type TimedSpan = { startsAt: string; endsAt: string; allDay: boolean };

/** Local calendar dates an event covers. All-day ends are exclusive dates. */
export function eventDayKeys(event: TimedSpan): string[] {
	const keys: string[] = [];
	if (event.allDay) {
		const end = utcDateKey(event.endsAt);
		for (let key = utcDateKey(event.startsAt); key < end && keys.length < 366;) {
			keys.push(key);
			key = addDaysToKey(key, 1);
		}
		return keys.length ? keys : [utcDateKey(event.startsAt)];
	}
	const start = new Date(event.startsAt);
	const end = new Date(event.endsAt);
	for (let day = startOfLocalDay(start); day < end && keys.length < 366;) {
		keys.push(dateKey(day));
		day = addLocalDays(day, 1);
	}
	return keys.length ? keys : [dateKey(start)];
}

/** Timed events that span a local midnight read better as banners than as grid blocks. */
export function isMultiDayTimed(event: TimedSpan): boolean {
	return !event.allDay && eventDayKeys(event).length > 1;
}

export type TimedLayout<T> = {
	item: T;
	startMinute: number;
	endMinute: number;
	column: number;
	columns: number;
};

function wallMinutes(date: Date): number {
	return date.getHours() * 60 + date.getMinutes();
}

/**
 * Positions timed items within one local day. Positions use wall-clock minutes so
 * hour lines stay aligned on daylight-saving transition days.
 */
export function layoutTimedEvents<T extends { startsAt: string; endsAt: string }>(
	items: T[],
	day: Date,
	minimumMinutes = 20,
): TimedLayout<T>[] {
	const dayStart = startOfLocalDay(day);
	const dayEnd = addLocalDays(dayStart, 1);
	const entries = items
		.map((item) => ({ item, start: new Date(item.startsAt), end: new Date(item.endsAt) }))
		.filter(({ start, end }) => start < dayEnd && (end > dayStart || +start === +end))
		.map(({ item, start, end }): TimedLayout<T> => {
			const startMinute = start <= dayStart ? 0 : wallMinutes(start);
			const rawEnd = end >= dayEnd ? MINUTES_PER_DAY : wallMinutes(end);
			return {
				item,
				startMinute,
				endMinute: Math.min(MINUTES_PER_DAY, Math.max(rawEnd, startMinute + minimumMinutes)),
				column: 0,
				columns: 1,
			};
		})
		.sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);

	let cluster: TimedLayout<T>[] = [];
	let columnEnds: number[] = [];
	let clusterEnd = -1;
	const finish = () => {
		for (const entry of cluster) entry.columns = columnEnds.length;
		cluster = [];
		columnEnds = [];
	};
	for (const entry of entries) {
		if (entry.startMinute >= clusterEnd) {
			finish();
			clusterEnd = -1;
		}
		let column = columnEnds.findIndex((end) => end <= entry.startMinute);
		if (column === -1) {
			column = columnEnds.length;
			columnEnds.push(entry.endMinute);
		} else {
			columnEnds[column] = entry.endMinute;
		}
		entry.column = column;
		cluster.push(entry);
		clusterEnd = Math.max(clusterEnd, entry.endMinute);
	}
	finish();
	return entries;
}

export function formatTime(value: Date | string, timeZone?: string): string {
	return new Date(value).toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
		timeZone,
	});
}

export function formatDateKey(key: string, options: Intl.DateTimeFormatOptions = {}): string {
	return keyToLocalDate(key).toLocaleDateString(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		...options,
	});
}

export function formatDateTime(value: Date | string, timeZone?: string): string {
	return new Date(value).toLocaleString(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZone,
	});
}

/** Human description of when an event happens, in the viewer's timezone. */
export function formatEventWhen(event: TimedSpan): string {
	if (event.allDay) {
		const start = utcDateKey(event.startsAt);
		const lastDay = addDaysToKey(utcDateKey(event.endsAt), -1);
		return lastDay <= start
			? `${formatDateKey(start, { weekday: "long", year: "numeric" })} · All day`
			: `${formatDateKey(start)} – ${formatDateKey(lastDay, { year: "numeric" })} · All day`;
	}
	const start = new Date(event.startsAt);
	const end = new Date(event.endsAt);
	if (dateKey(start) === dateKey(end)) {
		return `${start.toLocaleDateString(undefined, {
			weekday: "long",
			month: "short",
			day: "numeric",
		})} · ${formatTime(start)} – ${formatTime(end)}`;
	}
	return `${formatDateTime(start)} – ${formatDateTime(end)}`;
}

/** Short human offset such as "GMT+3" for a timezone at an instant. */
export function timezoneLabel(timeZone: string, at: Date = new Date()): string {
	const offset = timezoneOffsetMinutes(at, timeZone);
	if (offset === 0) return `${timeZone} (GMT)`;
	const sign = offset < 0 ? "-" : "+";
	const hours = Math.trunc(Math.abs(offset) / 60);
	const minutes = Math.abs(offset) % 60;
	return `${timeZone} (GMT${sign}${hours}${minutes ? `:${pad(minutes)}` : ""})`;
}
