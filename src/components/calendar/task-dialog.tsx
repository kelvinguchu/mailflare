"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, Circle, Flag, Globe, RefreshCw, Trash2 } from "lucide-react";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useCurrentAccount, type CurrentAccount } from "@/hooks/use-current-account";
import {
	calendarKeys,
	getCalendarTask,
	listCalendarTaskActivity,
	listCalendarTaskAssignees,
} from "@/lib/calendar/client";
import type {
	CalendarPriority,
	CalendarTaskAssignee,
	CalendarTaskRecord,
} from "@/lib/calendar/types";
import {
	browserTimezone,
	formatDateTime,
	timezoneLabel,
	wallClockToInstant,
} from "@/lib/calendar/wall-clock";
import { cn } from "@/lib/utils";
import { FormError, TimezoneSelect } from "./calendar-fields";
import type { ReminderTarget, TaskDialogState } from "./calendar-types";
import { PRIORITY_OPTIONS, PRIORITY_STYLES, errorMessage } from "./calendar-utils";
import { ItemReminders } from "./item-reminders";
import {
	buildTaskCreateInput,
	buildTaskPatch,
	describeTaskActivity,
	getPersonLabel,
	getTaskFormValues,
	getTaskPermissions,
	isTaskFormDirty,
	type TaskDueMode,
	type TaskFormValues,
} from "./task-utils";
import {
	useCreateTaskMutation,
	useDeleteTaskMutation,
	useTaskCompletionMutation,
	useUpdateTaskMutation,
} from "./use-task-mutations";

type TaskDialogProps = {
	state: TaskDialogState | null;
	onStateChange: (state: TaskDialogState | null) => void;
};

const DUE_MODES: Array<{ value: TaskDueMode; label: string }> = [
	{ value: "none", label: "No date" },
	{ value: "date", label: "Date" },
	{ value: "time", label: "Date & time" },
];

const TASK_NOT_FOUND = "Task not found";

export function TaskDialog({ state, onStateChange }: Readonly<TaskDialogProps>) {
	const close = () => onStateChange(null);
	return (
		<Dialog open={state !== null} onOpenChange={(open) => !open && close()}>
			{state && (
				<DialogContent className="sm:max-w-xl">
					{state.mode === "create" ? (
						<TaskEditor
							key="new"
							task={null}
							initialTitle={state.title}
							dueKey={state.dueKey}
							onCreated={(task) => onStateChange({ mode: "view", task })}
							onClose={close}
						/>
					) : (
						<ExistingTask key={state.task.id} task={state.task} onClose={close} />
					)}
				</DialogContent>
			)}
		</Dialog>
	);
}

export function taskReminderTarget(task: CalendarTaskRecord): ReminderTarget {
	return {
		kind: "task",
		id: task.id,
		title: task.title,
		timezone: task.timezone,
		anchor: task.dueAt ? { value: task.dueAt, allDay: task.allDay } : null,
		locked: task.status === "completed",
	};
}

/** Keeps the dialog on the latest server copy, which realtime events invalidate. */
function ExistingTask({
	task: initialTask,
	onClose,
}: Readonly<{ task: CalendarTaskRecord; onClose: () => void }>) {
	const detail = useQuery({
		queryKey: calendarKeys.task(initialTask.id),
		queryFn: () => getCalendarTask(initialTask.id),
		initialData: initialTask,
		initialDataUpdatedAt: 0,
		refetchOnMount: "always",
		retry: false,
	});
	if (detail.isError && detail.error.message === TASK_NOT_FOUND) {
		return (
			<>
				<DialogHeader>
					<DialogTitle>This task is no longer available</DialogTitle>
					<DialogDescription>
						It was deleted, or you are no longer its creator or assignee.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button type="button" onClick={onClose}>
						Close
					</Button>
				</DialogFooter>
			</>
		);
	}
	return <TaskEditor task={detail.data} onClose={onClose} />;
}

function TaskEditor({
	task,
	initialTitle,
	dueKey,
	onCreated,
	onClose,
}: Readonly<{
	task: CalendarTaskRecord | null;
	initialTitle?: string;
	dueKey?: string;
	onCreated?: (task: CalendarTaskRecord) => void;
	onClose: () => void;
}>) {
	const account = useCurrentAccount();
	const assignees = useQuery({
		queryKey: calendarKeys.assignees,
		queryFn: listCalendarTaskAssignees,
		staleTime: 5 * 60_000,
	});
	const create = useCreateTaskMutation();
	const update = useUpdateTaskMutation();
	const completion = useTaskCompletionMutation();
	const remove = useDeleteTaskMutation();

	const serverValues = useMemo(
		() =>
			getTaskFormValues(task, {
				timezone: browserTimezone(),
				assigneeUserId: account.data?.id ?? "",
				title: initialTitle,
				dueKey,
			}),
		[task, account.data?.id, initialTitle, dueKey],
	);
	const [baseline, setBaseline] = useState(serverValues);
	const [values, setValues] = useState(serverValues);
	const [validation, setValidation] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const dirty = isTaskFormDirty(values, baseline);
	// Only a server copy that differs from both the loaded and the typed values is a conflict.
	const remoteChanged =
		task !== null &&
		isTaskFormDirty(serverValues, baseline) &&
		isTaskFormDirty(serverValues, values);

	useEffect(() => {
		// Adopt someone else's change immediately unless it would discard local edits.
		if (dirty) return;
		setBaseline(serverValues);
		setValues(serverValues);
	}, [dirty, serverValues]);

	const permissions = task
		? getTaskPermissions(task, account.data)
		: { canEdit: true, canComplete: false, canReassign: true, canDelete: false };
	const completed = task?.status === "completed";
	const saving = create.isPending || update.isPending;

	function set<Key extends keyof TaskFormValues>(key: Key, value: TaskFormValues[Key]) {
		setValidation(null);
		setValues((current) => ({ ...current, [key]: value }));
	}

	function submit() {
		try {
			if (!task) {
				const input = buildTaskCreateInput(values);
				create.mutate(
					{ input, assignee: assignees.data?.find((item) => item.id === values.assigneeUserId) },
					{
						onSuccess: (created) => {
							// Assigning to someone else already announces itself from the mutation.
							if (created.creatorUserId === created.assigneeUserId) {
								toast.add({ title: "Task created", description: created.title, type: "success" });
							}
							onCreated?.(created);
						},
					},
				);
				return;
			}
			const patch = buildTaskPatch(values, baseline, permissions.canReassign);
			if (Object.keys(patch).length === 0) return;
			update.mutate(
				{ taskId: task.id, input: patch },
				{
					onSuccess: (saved) => {
						const reassigned = patch.assigneeUserId !== undefined;
						toast.add({
							title: reassigned ? "Task reassigned" : "Task saved",
							description: reassigned ? `Now assigned to ${saved.assigneeName}.` : undefined,
							type: "success",
						});
						const next = getTaskFormValues(saved, {
							timezone: browserTimezone(),
							assigneeUserId: saved.assigneeUserId,
						});
						setBaseline(next);
						setValues(next);
					},
				},
			);
		} catch (error) {
			setValidation(errorMessage(error));
		}
	}

	const mutationError = create.error ?? update.error;

	return (
		<>
			<form
				className="flex min-h-0 flex-1 flex-col"
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<DialogHeader className="gap-1 pb-3">
					<DialogTitle className="sr-only">{task ? "Task details" : "New task"}</DialogTitle>
					<DialogDescription className="sr-only">
						{task
							? "Review and change this task, its reminders, and its activity."
							: "Create a task for yourself or assign it to a colleague."}
					</DialogDescription>
					<div className="flex items-start gap-2.5">
						{task && (
							<span
								aria-hidden="true"
								className={cn("mt-2 shrink-0", completed ? "text-green-600" : "text-neutral-300")}
							>
								{completed ? <CircleCheck className="size-5" /> : <Circle className="size-5" />}
							</span>
						)}
						<Textarea
							aria-label="Task title"
							placeholder="What needs to be done?"
							value={values.title}
							maxLength={200}
							rows={1}
							disabled={!permissions.canEdit}
							onChange={(event) => set("title", event.target.value.replace(/\n/g, " "))}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									event.currentTarget.form?.requestSubmit();
								}
							}}
							className={cn(
								"min-h-10 resize-none border-0 px-0 py-1.5 text-lg font-medium wrap-break-word shadow-none focus-visible:ring-0 md:text-lg",
								completed && "text-neutral-500 line-through",
							)}
						/>
					</div>
					{task && <TaskPeopleLine task={task} account={account.data} />}
				</DialogHeader>

				<DialogBody className="space-y-5">
					{remoteChanged && dirty && (
						<div
							role="status"
							className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
						>
							<span>This task changed while you were editing.</span>
							<Button
								type="button"
								size="xs"
								variant="outline"
								onClick={() => {
									setBaseline(serverValues);
									setValues(serverValues);
								}}
							>
								<RefreshCw />
								Load latest
							</Button>
						</div>
					)}

					<dl className="grid grid-cols-1 gap-x-4 gap-y-3.5 text-sm sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:items-start">
						<dt className="pt-2 text-neutral-500">
							<label htmlFor="task-assignee">Assignee</label>
						</dt>
						<dd className="min-w-0">
							<AssigneeField
								value={values.assigneeUserId}
								task={task}
								account={account.data}
								assignees={assignees.data}
								loading={assignees.isPending}
								failed={assignees.isError}
								onRetry={() => void assignees.refetch()}
								disabled={!permissions.canReassign}
								onChange={(value) => set("assigneeUserId", value)}
							/>
						</dd>

						<dt className="pt-2 text-neutral-500">Due</dt>
						<dd className="min-w-0 space-y-2">
							<DueField values={values} disabled={!permissions.canEdit} onChange={set} />
						</dd>

						<dt className="pt-2 text-neutral-500">
							<label htmlFor="task-priority">Priority</label>
						</dt>
						<dd>
							<Select
								value={values.priority}
								disabled={!permissions.canEdit}
								onValueChange={(value) => value && set("priority", value as CalendarPriority)}
							>
								<SelectTrigger id="task-priority" className="w-full sm:w-48">
									<SelectValue>
										{(value: CalendarPriority) => (
											<>
												<Flag className={cn("size-4", PRIORITY_STYLES[value])} />
												{PRIORITY_OPTIONS.find((option) => option.value === value)?.label}
											</>
										)}
									</SelectValue>
								</SelectTrigger>
								<SelectContent alignItemWithTrigger={false}>
									{PRIORITY_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											<Flag className={cn("size-4", PRIORITY_STYLES[option.value])} />
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</dd>

						<dt className="pt-2 text-neutral-500">
							<label htmlFor="task-notes">Notes</label>
						</dt>
						<dd>
							<Textarea
								id="task-notes"
								rows={3}
								maxLength={10_000}
								value={values.description}
								disabled={!permissions.canEdit}
								placeholder="Add context, links, or next steps"
								onChange={(event) => set("description", event.target.value)}
								className="max-h-60 min-h-20"
							/>
						</dd>
					</dl>

					<FormError message={validation ?? (mutationError ? errorMessage(mutationError) : null)} />

					{task ? (
						<>
							<div className="border-t border-neutral-100 pt-4">
								<ItemReminders target={taskReminderTarget(task)} />
							</div>
							<div className="border-t border-neutral-100 pt-4">
								<TaskActivityList taskId={task.id} accountId={account.data?.id} />
							</div>
						</>
					) : (
						<p className="text-xs text-neutral-500">
							Reminders can be added once the task is created. Each person sets their own.
						</p>
					)}
				</DialogBody>

				<DialogFooter className="items-center">
					{task && permissions.canDelete && (
						<Button
							type="button"
							variant="ghost"
							className="text-red-600 hover:bg-red-50 hover:text-red-700 sm:mr-auto"
							onClick={() => setConfirmDelete(true)}
							disabled={remove.isPending}
						>
							<Trash2 />
							Delete
						</Button>
					)}
					{!task || dirty ? (
						<>
							<Button
								type="button"
								variant="ghost"
								disabled={saving}
								onClick={() => {
									if (task) {
										setValues(baseline);
										setValidation(null);
									} else {
										onClose();
									}
								}}
							>
								{task ? "Discard changes" : "Cancel"}
							</Button>
							<Button type="submit" disabled={saving || !values.title.trim()}>
								{saving ? "Saving…" : task ? "Save changes" : "Create task"}
							</Button>
						</>
					) : (
						<Button
							type="button"
							variant={completed ? "outline" : "default"}
							disabled={!permissions.canComplete || completion.isPending}
							onClick={() => completion.mutate({ task, completed: !completed })}
						>
							{completed ? <Circle /> : <CircleCheck />}
							{completed ? "Reopen task" : "Mark complete"}
						</Button>
					)}
				</DialogFooter>
			</form>

			{task && (
				<AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Delete this task?</AlertDialogTitle>
							<AlertDialogDescription>
								{task.creatorUserId === task.assigneeUserId
									? "The task and its reminders will be removed."
									: `The task will be removed for you and ${task.assigneeUserId === account.data?.id ? task.creatorName : task.assigneeName}, along with everyone’s reminders for it.`}{" "}
								This can’t be undone.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Keep task</AlertDialogCancel>
							<Button
								type="button"
								variant="destructive"
								disabled={remove.isPending}
								onClick={() => {
									// Deleting is optimistic; the mutation restores the task and reports if it fails.
									setConfirmDelete(false);
									onClose();
									remove.mutate(task);
								}}
							>
								{remove.isPending ? "Deleting…" : "Delete task"}
							</Button>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}
		</>
	);
}

function TaskPeopleLine({
	task,
	account,
}: Readonly<{ task: CalendarTaskRecord; account: CurrentAccount | undefined }>) {
	const assignee = getPersonLabel(task.assigneeUserId, task.assigneeName, account?.id);
	const creator = getPersonLabel(task.creatorUserId, task.creatorName, account?.id);
	return (
		<p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-neutral-500 sm:pl-7.5">
			<span className="min-w-0 truncate">
				Assigned to <span className="font-medium text-neutral-800">{assignee}</span>
			</span>
			{task.creatorUserId !== task.assigneeUserId && (
				<span className="min-w-0 truncate">
					Created by <span className="font-medium text-neutral-800">{creator}</span>
				</span>
			)}
			{task.status === "completed" && task.completedAt && (
				<span className="min-w-0 truncate">
					Completed {formatDateTime(task.completedAt)}
					{task.completedByUserId &&
						` by ${task.completedByUserId === task.assigneeUserId ? assignee : creator}`}
				</span>
			)}
		</p>
	);
}

function AssigneeField({
	value,
	task,
	account,
	assignees,
	loading,
	failed,
	onRetry,
	disabled,
	onChange,
}: Readonly<{
	value: string;
	task: CalendarTaskRecord | null;
	account: CurrentAccount | undefined;
	assignees: CalendarTaskAssignee[] | undefined;
	loading: boolean;
	failed: boolean;
	onRetry: () => void;
	disabled: boolean;
	onChange: (value: string) => void;
}>) {
	// The current assignee stays selectable even if the account was since disabled.
	const options = useMemo(() => {
		const list = [...(assignees ?? [])];
		if (task && !list.some((item) => item.id === task.assigneeUserId)) {
			list.unshift({
				id: task.assigneeUserId,
				name: task.assigneeName,
				email: task.assigneeEmail,
				hasAvatar: false,
			});
		}
		return list;
	}, [assignees, task]);
	const nameFor = (id: string) => {
		if (id === account?.id) return "Me";
		return options.find((item) => item.id === id)?.name ?? task?.assigneeName ?? "Me";
	};

	return (
		<div className="space-y-1">
			<Select
				value={value}
				onValueChange={(next) => next && onChange(next)}
				disabled={disabled || loading || failed}
			>
				<SelectTrigger id="task-assignee" className="w-full sm:w-72">
					<SelectValue placeholder="Me">{(id: string) => nameFor(id)}</SelectValue>
				</SelectTrigger>
				<SelectContent alignItemWithTrigger={false} className="max-h-72">
					{options.map((person) => (
						<SelectItem key={person.id} value={person.id}>
							<span className="flex min-w-0 flex-col">
								<span className="truncate">
									{person.name}
									{person.id === account?.id && <span className="text-neutral-500"> (you)</span>}
								</span>
								<span className="truncate text-xs text-neutral-500">{person.email}</span>
							</span>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{failed && (
				<p className="text-xs text-neutral-500">
					People couldn’t be loaded.{" "}
					<button
						type="button"
						className="font-medium text-primary hover:underline"
						onClick={onRetry}
					>
						Try again
					</button>
				</p>
			)}
			{task && disabled && !failed && (
				<p className="text-xs text-neutral-500">
					Only {getPersonLabel(task.creatorUserId, task.creatorName, account?.id)} can change the
					assignee.
				</p>
			)}
		</div>
	);
}

function DueField({
	values,
	disabled,
	onChange,
}: Readonly<{
	values: TaskFormValues;
	disabled: boolean;
	onChange: <Key extends keyof TaskFormValues>(key: Key, value: TaskFormValues[Key]) => void;
}>) {
	const localZone = browserTimezone();
	return (
		<>
			<div
				className="inline-grid grid-cols-3 gap-0.5 rounded-lg bg-neutral-100 p-0.5"
				role="radiogroup"
				aria-label="Due date"
			>
				{DUE_MODES.map((option) => (
					<button
						key={option.value}
						type="button"
						role="radio"
						aria-checked={values.dueMode === option.value}
						disabled={disabled}
						onClick={() => onChange("dueMode", option.value)}
						className={cn(
							"rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50",
							values.dueMode === option.value
								? "bg-white text-neutral-900 shadow-sm"
								: "text-neutral-500 hover:text-neutral-800",
						)}
					>
						{option.label}
					</button>
				))}
			</div>
			{values.dueMode === "date" && (
				<Input
					type="date"
					required
					aria-label="Due date"
					value={values.dueDate}
					disabled={disabled}
					onChange={(event) => onChange("dueDate", event.target.value)}
					className="w-full sm:w-48"
				/>
			)}
			{values.dueMode === "time" && (
				<div className="grid gap-2 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
					<Input
						type="datetime-local"
						required
						aria-label="Due date and time"
						value={values.dueTime}
						disabled={disabled}
						onChange={(event) => onChange("dueTime", event.target.value)}
					/>
					<TimezoneSelect value={values.timezone} onChange={(zone) => onChange("timezone", zone)} />
				</div>
			)}
			{values.dueMode === "time" && values.timezone !== localZone && values.dueTime && (
				<p className="flex items-center gap-1.5 text-xs text-neutral-500">
					<Globe className="size-3.5 shrink-0" aria-hidden="true" />
					{formatDateTime(wallClockToInstant(values.dueTime, values.timezone))} in your timezone (
					{timezoneLabel(localZone)})
				</p>
			)}
		</>
	);
}

const ACTIVITY_PREVIEW = 5;

function TaskActivityList({
	taskId,
	accountId,
}: Readonly<{ taskId: string; accountId: string | undefined }>) {
	const [expanded, setExpanded] = useState(false);
	const activity = useQuery({
		queryKey: calendarKeys.activity(taskId),
		queryFn: () => listCalendarTaskActivity(taskId),
	});
	const items = activity.data ?? [];
	const visible = expanded ? items : items.slice(0, ACTIVITY_PREVIEW);

	return (
		<section aria-labelledby="task-activity-heading" className="space-y-2">
			<h3
				id="task-activity-heading"
				className="text-xs font-medium tracking-wide text-neutral-500 uppercase"
			>
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
			{visible.length > 0 && (
				<ol className="space-y-1.5">
					{visible.map((item) => {
						const { actor, text } = describeTaskActivity(item, accountId);
						return (
							<li key={item.id} className="flex items-baseline gap-3 text-sm">
								<span className="min-w-0 flex-1 wrap-break-word text-neutral-700">
									<span className="font-medium text-neutral-900">{actor}</span> {text}
								</span>
								<time dateTime={item.createdAt} className="shrink-0 text-xs text-neutral-400">
									{formatDateTime(item.createdAt)}
								</time>
							</li>
						);
					})}
				</ol>
			)}
			{items.length > ACTIVITY_PREVIEW && (
				<button
					type="button"
					className="text-xs font-medium text-primary hover:underline"
					onClick={() => setExpanded((current) => !current)}
				>
					{expanded ? "Show less" : `Show all ${items.length}`}
				</button>
			)}
		</section>
	);
}
