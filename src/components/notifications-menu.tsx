"use client";

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { TaskDialog } from "@/components/calendar/task-dialog";
import type { TaskDialogState } from "@/components/calendar/calendar-types";
import { Tooltip } from "@/components/ui/tooltip";
import { AccountActivityPanel, AttentionDot, useAccountActivity } from "./account-activity";

/** Tasks, due reminders, and task updates, with a dot while something needs attention. */
export function NotificationsMenu() {
	const activity = useAccountActivity();
	const [open, setOpen] = useState(false);
	const [taskDialog, setTaskDialog] = useState<TaskDialogState | null>(null);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		function onPointerDown(event: PointerEvent) {
			if (!ref.current?.contains(event.target as Node)) setOpen(false);
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") setOpen(false);
		}
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const attention = activity.attention;
	const label =
		attention > 0
			? `Tasks and notifications, ${attention} ${attention === 1 ? "item needs" : "items need"} attention`
			: "Tasks and notifications";

	return (
		<div ref={ref} className="relative">
			<Tooltip label="Tasks and notifications">
				<button
					type="button"
					onClick={() => setOpen((value) => !value)}
					aria-label={label}
					aria-expanded={open}
					className="relative flex size-10 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-200 focus-visible:ring-2 focus-visible:ring-primary/40"
				>
					<Bell aria-hidden="true" className="size-5" />
					<AttentionDot show={attention > 0} />
				</button>
			</Tooltip>
			{open && (
				<div className="absolute top-12 right-0 z-50 flex max-h-[min(560px,calc(100dvh-5rem))] w-[min(400px,calc(100vw-16px))] flex-col overflow-hidden rounded-3xl border border-neutral-200 bg-white pb-1 shadow-2xl shadow-neutral-900/20">
					<AccountActivityPanel
						activity={activity}
						onNavigate={() => setOpen(false)}
						onNewTask={() => {
							setOpen(false);
							setTaskDialog({ mode: "create" });
						}}
						onOpenTask={(task) => {
							setOpen(false);
							setTaskDialog({ mode: "view", task });
						}}
					/>
				</div>
			)}
			<TaskDialog state={taskDialog} onStateChange={setTaskDialog} />
		</div>
	);
}
