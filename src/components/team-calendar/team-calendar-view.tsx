"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ListFilter, RefreshCw, Users } from "lucide-react";
import { queryRange, visibleDays } from "@/app/(dashboard)/calendar/utils";
import type {
	CalendarGridProps,
	CalendarItemOwner,
	CalendarView,
} from "@/components/calendar/calendar-types";
import {
	CalendarRangeNav,
	CalendarViewSwitch,
	useCalendarShortcuts,
} from "@/components/calendar/calendar-toolbar";
import { PRIORITY_OPTIONS, errorMessage } from "@/components/calendar/calendar-utils";
import { MonthView } from "@/components/calendar/month-view";
import { TimeGridView } from "@/components/calendar/time-grid-view";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip } from "@/components/ui/tooltip";
import { authFetch, AUTH_SESSION_CHANGED_EVENT } from "@/lib/auth/client";
import type { CalendarEventRecord, CalendarTaskRecord } from "@/lib/calendar/types";
import { startOfLocalDay } from "@/lib/calendar/wall-clock";
import type { TeamCalendarData, TeamCalendarPerson } from "@/lib/team-calendar/types";
import { cn } from "@/lib/utils";
import { TeamCalendarDetails, type TeamCalendarSelection } from "./team-calendar-details";
import {
	DEFAULT_TEAM_FILTERS,
	TEAM_KIND_OPTIONS,
	UNKNOWN_PERSON_COLOR,
	activeFilterCount,
	filterTeamCalendar,
	itemCounts,
	legendPeople,
	personColors,
	personInitials,
	taskPersonId,
	type TeamCalendarFilters,
	type TeamCalendarKind,
} from "./team-calendar-utils";

const EMPTY: TeamCalendarData = { people: [], events: [], tasks: [], truncated: false };

async function readTeamCalendar(start: string, end: string): Promise<TeamCalendarData> {
	const response = await authFetch(`/api/team-calendar?${new URLSearchParams({ start, end })}`, {
		cache: "no-store",
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as { error?: string } | null;
		throw new Error(
			response.status === 403
				? "Inspection access denied"
				: (body?.error ?? "Couldn’t load the team calendar"),
		);
	}
	return response.json() as Promise<TeamCalendarData>;
}

export function TeamCalendarView({ viewerId }: Readonly<{ viewerId: string }>) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [view, setView] = useState<CalendarView>("month");
	const [anchor, setAnchor] = useState(() => startOfLocalDay(new Date()));
	const [filters, setFilters] = useState<TeamCalendarFilters>(DEFAULT_TEAM_FILTERS);
	const [hiddenPeople, setHiddenPeople] = useState<ReadonlySet<string>>(() => new Set());
	const [selection, setSelection] = useState<TeamCalendarSelection | null>(null);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [filterOpen, setFilterOpen] = useState(false);
	const [peopleOpen, setPeopleOpen] = useState(false);

	const days = useMemo(() => visibleDays(view, anchor), [view, anchor]);
	const range = useMemo(() => queryRange(days), [days]);
	const calendar = useQuery({
		queryKey: ["team-calendar", viewerId, range.start, range.end],
		queryFn: () => readTeamCalendar(range.start, range.end),
		placeholderData: keepPreviousData,
		refetchOnMount: "always",
		refetchInterval: 60_000,
	});

	useEffect(() => {
		const controller = new AbortController();
		// Leaves the page and drops the team's data as soon as the signed-in account changes.
		const clear = () => {
			controller.abort();
			queryClient.removeQueries({ queryKey: ["team-calendar"] });
			router.replace("/inbox");
		};
		window.addEventListener(AUTH_SESSION_CHANGED_EVENT, clear);
		void authFetch("/api/team-calendar/session", {
			method: "POST",
			signal: controller.signal,
		}).catch(() => {});
		return () => {
			controller.abort();
			window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, clear);
		};
	}, [queryClient, router]);

	useCalendarShortcuts({
		disabled: detailsOpen || filterOpen || peopleOpen,
		view,
		onViewChange: setView,
		onAnchorChange: setAnchor,
	});

	const data = calendar.data ?? EMPTY;
	const colors = useMemo(() => personColors(data.people), [data.people]);
	const peopleById = useMemo(
		() => new Map(data.people.map((person) => [person.id, person])),
		[data.people],
	);
	const counts = useMemo(() => itemCounts(data), [data]);
	const legend = useMemo(() => legendPeople(data.people, counts), [data.people, counts]);
	const visible = useMemo(
		() => filterTeamCalendar(data, filters, hiddenPeople),
		[data, filters, hiddenPeople],
	);

	const lookup = useCallback(
		(id: string) => ({ person: peopleById.get(id), color: colors.get(id) ?? UNKNOWN_PERSON_COLOR }),
		[peopleById, colors],
	);
	const owner = useCallback(
		(id: string, upcoming = false): CalendarItemOwner => {
			const person = peopleById.get(id);
			return {
				name: person?.name || person?.email || "Unknown person",
				color: colors.get(id) ?? UNKNOWN_PERSON_COLOR,
				upcoming,
			};
		},
		[peopleById, colors],
	);
	const tasksById = useMemo(
		() => new Map(visible.tasks.map((task) => [task.id, task])),
		[visible.tasks],
	);
	const eventsById = useMemo(
		() => new Map(visible.events.map((event) => [event.id, event])),
		[visible.events],
	);

	function select(next: TeamCalendarSelection) {
		setPeopleOpen(false);
		setSelection(next);
		setDetailsOpen(true);
	}

	// The shared grid hands back the records it was given, so ids find the team fields.
	const gridProps: CalendarGridProps = {
		days,
		anchor,
		events: visible.events,
		tasks: visible.tasks,
		onSelectEvent: (event: CalendarEventRecord) => {
			const found = eventsById.get(event.id);
			if (found) select({ kind: "event", event: found });
		},
		onSelectTask: (task: CalendarTaskRecord) => {
			const found = tasksById.get(task.id);
			if (found) select({ kind: "task", task: found });
		},
		onOpenDay: (day) => {
			setAnchor(startOfLocalDay(day));
			setView("day");
		},
		owners: {
			event: (event) => owner(eventsById.get(event.id)?.ownerUserId ?? ""),
			task: (task) => owner(taskPersonId(task), tasksById.get(task.id)?.upcoming),
		},
	};

	const filterCount = activeFilterCount(filters);
	const panel = (
		<PeoplePanel
			people={legend}
			viewerId={viewerId}
			colors={colors}
			counts={counts}
			hidden={hiddenPeople}
			onHiddenChange={setHiddenPeople}
		/>
	);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-neutral-100 px-3 py-3 sm:gap-x-3 sm:px-6">
				<h1 className="flex items-center gap-2 text-xl font-medium text-neutral-900">
					<CalendarDays aria-hidden="true" className="size-6 text-primary" />
					<span className="sr-only sm:not-sr-only">Team’s calendar</span>
				</h1>
				<CalendarRangeNav
					view={view}
					days={days}
					anchor={anchor}
					onAnchorChange={setAnchor}
					busy={calendar.isFetching}
				/>
				<span className="flex-1" />
				<Select
					value={filters.kind}
					onValueChange={(value) =>
						setFilters((current) => ({ ...current, kind: (value ?? "all") as TeamCalendarKind }))
					}
				>
					<SelectTrigger aria-label="Item type" size="sm" className="w-max">
						<SelectValue>
							{() => TEAM_KIND_OPTIONS.find((option) => option.value === filters.kind)?.label}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{TEAM_KIND_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Tooltip label="Filters">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={filterCount ? `Filters (${filterCount} on)` : "Filters"}
						onClick={() => setFilterOpen(true)}
						className={filterCount ? "bg-primary/10 text-primary" : undefined}
					>
						<ListFilter className="size-4" />
					</Button>
				</Tooltip>
				<Tooltip label="Refresh">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Refresh"
						disabled={calendar.isFetching}
						onClick={() => void calendar.refetch()}
					>
						<RefreshCw className="size-4" />
					</Button>
				</Tooltip>
				<CalendarViewSwitch view={view} onViewChange={setView} />
				<Button
					variant="outline"
					size="icon-sm"
					className="rounded-full lg:hidden"
					aria-label="People"
					onClick={() => setPeopleOpen(true)}
				>
					<Users />
				</Button>
			</header>

			<div className="flex min-h-0 flex-1">
				<section
					className="flex min-w-0 flex-1 flex-col overflow-auto overscroll-contain"
					aria-label="Team calendar grid"
					aria-busy={calendar.isFetching}
				>
					{calendar.error && (
						<p
							role="alert"
							className="mx-4 mt-3 rounded-lg border border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700"
						>
							{errorMessage(calendar.error, "Couldn’t load the team calendar.")}
						</p>
					)}
					{data.truncated && (
						<p
							role="status"
							className="mx-4 mt-3 rounded-lg border border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-800"
						>
							This range has more items than can be shown at once. Switch to a week or day to see
							them all.
						</p>
					)}
					<div
						className={cn(
							"h-full min-h-0 flex-1",
							// Phones fit month and day to the screen; week scrolls sideways inside this section.
							view === "month" && "min-w-[44rem] max-md:min-w-0",
							view === "week" && "min-w-[56rem] max-md:min-w-[36rem]",
							view === "day" && "min-w-[28rem] max-md:min-w-0",
						)}
					>
						{view === "month" ? <MonthView {...gridProps} /> : <TimeGridView {...gridProps} />}
					</div>
				</section>
				<aside className="hidden w-72 shrink-0 flex-col border-l border-neutral-100 lg:flex">
					{panel}
				</aside>
			</div>

			<Sheet open={peopleOpen} onOpenChange={setPeopleOpen}>
				<SheetContent className="w-[min(20rem,100vw)] gap-0 p-0 pt-10">
					<SheetTitle className="sr-only">People</SheetTitle>
					{peopleOpen && panel}
				</SheetContent>
			</Sheet>

			<TeamCalendarDetails
				selection={selection}
				open={detailsOpen}
				onOpenChange={setDetailsOpen}
				lookup={lookup}
			/>

			<FiltersDialog
				open={filterOpen}
				onOpenChange={setFilterOpen}
				filters={filters}
				onApply={setFilters}
			/>
		</div>
	);
}

/** Legend and people filter: each person's color, item count, and whether they're shown. */
function PeoplePanel({
	people,
	viewerId,
	colors,
	counts,
	hidden,
	onHiddenChange,
}: Readonly<{
	people: TeamCalendarPerson[];
	viewerId: string;
	colors: ReadonlyMap<string, string>;
	counts: ReadonlyMap<string, number>;
	hidden: ReadonlySet<string>;
	onHiddenChange: (hidden: ReadonlySet<string>) => void;
}>) {
	const toggle = (id: string) => {
		const next = new Set(hidden);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		onHiddenChange(next);
	};
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4 pb-2">
				<h2 className="text-sm font-semibold text-neutral-900">People</h2>
				<div className="flex gap-1">
					<Button
						variant="ghost"
						size="xs"
						disabled={hidden.size === 0}
						onClick={() => onHiddenChange(new Set())}
					>
						Show all
					</Button>
					<Button
						variant="ghost"
						size="xs"
						disabled={people.every((person) => hidden.has(person.id))}
						onClick={() => onHiddenChange(new Set(people.map((person) => person.id)))}
					>
						Hide all
					</Button>
				</div>
			</div>
			{people.length === 0 && <p className="px-4 py-2 text-sm text-neutral-500">No team members</p>}
			<ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
				{people.map((person) => {
					const color = colors.get(person.id) ?? UNKNOWN_PERSON_COLOR;
					const shown = !hidden.has(person.id);
					const count = counts.get(person.id) ?? 0;
					const name = person.name || person.email;
					return (
						<li
							key={person.id}
							className="group flex items-center gap-1 rounded-lg hover:bg-neutral-50"
						>
							<label
								htmlFor={`team-person-${person.id}`}
								className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-2 py-1.5"
							>
								<input
									id={`team-person-${person.id}`}
									type="checkbox"
									aria-label={`Show ${name}`}
									checked={shown}
									onChange={() => toggle(person.id)}
									className="size-4 shrink-0 rounded"
									style={{ accentColor: color }}
								/>
								<span
									aria-hidden="true"
									className={cn(
										"flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white",
										!shown && "opacity-40",
									)}
									style={{ backgroundColor: color }}
								>
									{personInitials(person.name, person.email)}
								</span>
								<span className={cn("min-w-0 flex-1", !shown && "text-neutral-400")}>
									<span className="block truncate text-sm">
										{name}
										{person.id === viewerId && <span className="text-neutral-500"> (you)</span>}
									</span>
									<span className="block truncate text-xs text-neutral-500">
										{count === 0 ? "Nothing in view" : `${count} ${count === 1 ? "item" : "items"}`}
										{!person.active && " · inactive"}
									</span>
								</span>
							</label>
							<Button
								variant="ghost"
								size="xs"
								className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
								aria-label={`Show only ${name}`}
								onClick={() =>
									onHiddenChange(
										new Set(
											people.filter((other) => other.id !== person.id).map((other) => other.id),
										),
									)
								}
							>
								Only
							</Button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function FiltersDialog({
	open,
	onOpenChange,
	filters,
	onApply,
}: Readonly<{
	open: boolean;
	onOpenChange: (open: boolean) => void;
	filters: TeamCalendarFilters;
	onApply: (filters: TeamCalendarFilters) => void;
}>) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Filter calendar</DialogTitle>
				</DialogHeader>
				<DialogBody>
					<form
						key={JSON.stringify(filters)}
						className="grid gap-4 sm:grid-cols-2"
						onSubmit={(event) => {
							event.preventDefault();
							const form = new FormData(event.currentTarget);
							onApply({
								kind: filters.kind,
								title: String(form.get("title") ?? ""),
								status: String(form.get("status") ?? "any") as TeamCalendarFilters["status"],
								priority: String(form.get("priority") ?? "any") as TeamCalendarFilters["priority"],
								repeating: form.get("repeating") === "true",
							});
							onOpenChange(false);
						}}
					>
						<label htmlFor="team-calendar-filter-title" className="text-sm sm:col-span-2">
							Title
							<Input id="team-calendar-filter-title" name="title" defaultValue={filters.title} />
						</label>
						<p className="-mb-2 text-xs text-neutral-500 sm:col-span-2">
							Status, priority and repeat apply to tasks.
						</p>
						<label htmlFor="team-calendar-filter-status" className="text-sm">
							Task status
							<select
								id="team-calendar-filter-status"
								name="status"
								defaultValue={filters.status}
								className="mt-1 block w-full rounded-md border p-2 text-sm"
							>
								<option value="any">Any</option>
								<option value="open">Open</option>
								<option value="overdue">Overdue</option>
								<option value="completed">Completed</option>
							</select>
						</label>
						<label htmlFor="team-calendar-filter-priority" className="text-sm">
							Priority
							<select
								id="team-calendar-filter-priority"
								name="priority"
								defaultValue={filters.priority}
								className="mt-1 block w-full rounded-md border p-2 text-sm"
							>
								<option value="any">Any</option>
								{PRIORITY_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</label>
						<label className="text-sm">
							<input
								aria-label="Repeating tasks only"
								type="checkbox"
								name="repeating"
								value="true"
								defaultChecked={filters.repeating}
							/>{" "}
							Repeating tasks only
						</label>
						<div className="flex justify-end gap-2 sm:col-span-2">
							<Button
								variant="outline"
								type="button"
								onClick={() => {
									onApply({ ...DEFAULT_TEAM_FILTERS, kind: filters.kind });
									onOpenChange(false);
								}}
							>
								Clear
							</Button>
							<Button type="submit">Apply</Button>
						</div>
					</form>
				</DialogBody>
			</DialogContent>
		</Dialog>
	);
}
