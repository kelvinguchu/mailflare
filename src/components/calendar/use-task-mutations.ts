"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";
import { useCurrentAccount } from "@/hooks/use-current-account";
import {
	calendarKeys,
	createCalendarTask,
	deleteCalendarTask,
	setCalendarTaskCompleted,
	updateCalendarTask,
} from "@/lib/calendar/client";
import type {
	CalendarTaskAssignee,
	CalendarTaskInput,
	CalendarTaskListParams,
	CalendarTaskPatchInput,
	CalendarTaskRecord,
} from "@/lib/calendar/types";
import { errorMessage } from "./calendar-utils";
import { buildOptimisticTask, taskMatchesListParams } from "./task-utils";

type ListSnapshot = Array<[readonly unknown[], CalendarTaskRecord[] | undefined]>;
type DetailSnapshot = Array<[readonly unknown[], CalendarTaskRecord | undefined]>;
type Snapshot = { lists: ListSnapshot; details: DetailSnapshot };

export const COMPLETED_REMINDER_NOTE = "Pending reminders for this task were cancelled.";
export const REOPENED_REMINDER_NOTE =
	"Cancelled reminders stay cancelled. Add a new reminder if you still need one.";

/** Refreshes everything a task change can affect, including reminders it cancelled. */
export function invalidateTaskQueries(queryClient: QueryClient) {
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: calendarKeys.taskLists }),
		queryClient.invalidateQueries({ queryKey: calendarKeys.taskDetails }),
		queryClient.invalidateQueries({ queryKey: calendarKeys.taskActivity }),
		queryClient.invalidateQueries({ queryKey: calendarKeys.reminderLists }),
	]);
}

async function snapshotTasks(queryClient: QueryClient): Promise<Snapshot> {
	await Promise.all([
		queryClient.cancelQueries({ queryKey: calendarKeys.taskLists }),
		queryClient.cancelQueries({ queryKey: calendarKeys.taskDetails }),
	]);
	return {
		lists: queryClient.getQueriesData<CalendarTaskRecord[]>({ queryKey: calendarKeys.taskLists }),
		details: queryClient.getQueriesData<CalendarTaskRecord>({ queryKey: calendarKeys.taskDetails }),
	};
}

function restoreTasks(queryClient: QueryClient, snapshot: Snapshot | undefined) {
	if (!snapshot) return;
	for (const [key, data] of snapshot.lists) queryClient.setQueryData(key, data);
	for (const [key, data] of snapshot.details) queryClient.setQueryData(key, data);
}

function updateTaskLists(
	queryClient: QueryClient,
	update: (tasks: CalendarTaskRecord[], params: CalendarTaskListParams) => CalendarTaskRecord[],
) {
	for (const [key, data] of queryClient.getQueriesData<CalendarTaskRecord[]>({
		queryKey: calendarKeys.taskLists,
	})) {
		const params = key[2];
		if (!data || typeof params !== "object" || params === null) continue;
		queryClient.setQueryData(key, update(data, params as CalendarTaskListParams));
	}
}

function replaceTask(queryClient: QueryClient, task: CalendarTaskRecord) {
	updateTaskLists(queryClient, (tasks) =>
		tasks.map((item) => (item.id === task.id ? { ...item, ...task } : item)),
	);
	queryClient.setQueryData(calendarKeys.task(task.id), task);
}

export function useTaskCompletionMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ task, completed }: { task: CalendarTaskRecord; completed: boolean }) =>
			setCalendarTaskCompleted(task.id, completed),
		onMutate: async ({ task, completed }) => {
			const snapshot = await snapshotTasks(queryClient);
			// The row stays in place, checked or unchecked, until the server list reconciles.
			const now = new Date().toISOString();
			replaceTask(queryClient, {
				...task,
				status: completed ? "completed" : "open",
				completedAt: completed ? now : null,
			});
			return snapshot;
		},
		onError: (error, _variables, snapshot) => {
			restoreTasks(queryClient, snapshot);
			toast.add({ title: "Task not updated", description: errorMessage(error), type: "error" });
		},
		onSuccess: (task, { completed }) => {
			replaceTask(queryClient, task);
			toast.add({
				title: completed ? "Task completed" : "Task reopened",
				description: completed ? COMPLETED_REMINDER_NOTE : REOPENED_REMINDER_NOTE,
				type: "success",
			});
		},
		onSettled: () => {
			void invalidateTaskQueries(queryClient);
		},
	});
}

export function useCreateTaskMutation() {
	const queryClient = useQueryClient();
	const account = useCurrentAccount();
	return useMutation({
		mutationFn: ({ input }: { input: CalendarTaskInput; assignee?: CalendarTaskAssignee }) =>
			createCalendarTask(input),
		onMutate: async ({ input, assignee }) => {
			const snapshot = await snapshotTasks(queryClient);
			const viewer = account.data;
			if (viewer) {
				const optimistic = buildOptimisticTask(input, viewer, assignee);
				updateTaskLists(queryClient, (tasks, params) =>
					taskMatchesListParams(optimistic, params, viewer.id) ? [optimistic, ...tasks] : tasks,
				);
			}
			return snapshot;
		},
		onError: (error, _variables, snapshot) => {
			restoreTasks(queryClient, snapshot);
			toast.add({ title: "Task not created", description: errorMessage(error), type: "error" });
		},
		onSuccess: (task) => {
			if (task.creatorUserId !== task.assigneeUserId) {
				toast.add({
					title: "Task assigned",
					description: `${task.assigneeName} will see it under Assigned to me.`,
					type: "success",
				});
			}
		},
		onSettled: () => {
			void invalidateTaskQueries(queryClient);
		},
	});
}

export function useUpdateTaskMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ taskId, input }: { taskId: string; input: CalendarTaskPatchInput }) =>
			updateCalendarTask(taskId, input),
		onSuccess: (task) => replaceTask(queryClient, task),
		onSettled: () => {
			void invalidateTaskQueries(queryClient);
		},
	});
}

export function useDeleteTaskMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (task: CalendarTaskRecord) => deleteCalendarTask(task.id),
		onMutate: async (task) => {
			const snapshot = await snapshotTasks(queryClient);
			updateTaskLists(queryClient, (tasks) => tasks.filter((item) => item.id !== task.id));
			return snapshot;
		},
		onError: (error, _task, snapshot) => {
			restoreTasks(queryClient, snapshot);
			toast.add({ title: "Task not deleted", description: errorMessage(error), type: "error" });
		},
		onSuccess: (_result, task) => {
			queryClient.removeQueries({ queryKey: calendarKeys.task(task.id) });
			toast.add({ title: "Task deleted", description: task.title, type: "success" });
		},
		onSettled: () => {
			void invalidateTaskQueries(queryClient);
		},
	});
}
