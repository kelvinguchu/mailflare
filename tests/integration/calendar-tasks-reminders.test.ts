import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createCalendarReminder,
	dispatchDueCalendarReminders,
	listCalendarReminderDeliveries,
	listCalendarReminders,
	snoozeCalendarReminder,
	updateCalendarReminder,
} from "@/lib/calendar/reminders";
import {
	createCalendarTask,
	listCalendarTaskActivity,
	listCalendarTasks,
	requireOwnedTask,
	setCalendarTaskCompleted,
} from "@/lib/calendar/tasks";
import { CalendarInputError } from "@/lib/calendar/validation";
import {
	createMailEnv,
	fixtureIds,
	resetIntegrationState,
	seedMailboxWorld,
	sessionUser,
} from "./fixtures";
import { integrationEnv } from "./bindings";

beforeEach(async () => {
	await resetIntegrationState();
	await seedMailboxWorld();
});

describe("calendar tasks and reminders", () => {
	it("keeps task ownership isolated and cancels pending reminders on completion", async () => {
		const env = createMailEnv();
		const task = await createCalendarTask(env, sessionUser(fixtureIds.owner), {
			title: "Submit release report",
			dueAt: "2026-09-14T09:00:00+03:00",
			timezone: "Africa/Nairobi",
			priority: "high",
		});
		const reminder = await createCalendarReminder(env, sessionUser(fixtureIds.owner), {
			taskId: task.id,
			remindAt: "2026-09-14T08:30:00+03:00",
			timezone: "Africa/Nairobi",
		});

		await expect(requireOwnedTask(env, fixtureIds.stranger, task.id)).rejects.toBeInstanceOf(
			CalendarInputError,
		);
		expect(
			await listCalendarTasks(env, sessionUser(fixtureIds.stranger), {
				status: "all",
				scope: "all",
				overdue: false,
				start: null,
				end: null,
			}),
		).toEqual([]);

		const completed = await setCalendarTaskCompleted(
			env,
			sessionUser(fixtureIds.owner),
			task.id,
			true,
		);
		expect(completed.status).toBe("completed");
		const storedReminder = await integrationEnv.DB.prepare(
			"SELECT status FROM calendar_reminders WHERE id = ?",
		)
			.bind(reminder.id)
			.first<{ status: string }>();
		expect(storedReminder?.status).toBe("cancelled");
		await expect(
			updateCalendarReminder(env, sessionUser(fixtureIds.owner), reminder.id, {
				remindAt: "2026-09-15T08:30:00+03:00",
			}),
		).rejects.toMatchObject({ status: 409 });

		const reopened = await setCalendarTaskCompleted(
			env,
			sessionUser(fixtureIds.owner),
			task.id,
			false,
		);
		expect(reopened.status).toBe("open");
		expect(reopened.completedAt).toBeNull();
	});

	it("lets an active colleague work an assigned task without exposing it to others", async () => {
		const env = createMailEnv();
		const task = await createCalendarTask(env, sessionUser(fixtureIds.owner), {
			title: "Approve launch copy",
			assigneeUserId: fixtureIds.delegate,
		});

		expect(task).toMatchObject({
			creatorUserId: fixtureIds.owner,
			assigneeUserId: fixtureIds.delegate,
			assigneeName: "Delegate",
		});
		expect(
			await listCalendarTasks(env, sessionUser(fixtureIds.delegate), {
				status: "open",
				scope: "assigned",
				overdue: false,
				start: null,
				end: null,
			}),
		).toHaveLength(1);
		expect(
			await listCalendarTasks(env, sessionUser(fixtureIds.stranger), {
				status: "all",
				scope: "all",
				overdue: false,
				start: null,
				end: null,
			}),
		).toEqual([]);

		const reminder = await createCalendarReminder(env, sessionUser(fixtureIds.delegate), {
			taskId: task.id,
			remindAt: "2026-09-15T08:00:00Z",
		});
		expect(reminder.userId).toBe(fixtureIds.delegate);

		const completed = await setCalendarTaskCompleted(
			env,
			sessionUser(fixtureIds.delegate),
			task.id,
			true,
		);
		expect(completed).toMatchObject({
			status: "completed",
			completedByUserId: fixtureIds.delegate,
		});
		const activity = await listCalendarTaskActivity(env, sessionUser(fixtureIds.delegate), task.id);
		expect(activity.map((item) => item.action)).toEqual(
			expect.arrayContaining(["created", "completed"]),
		);
		expect(await dispatchDueCalendarReminders(env, new Date("2026-09-16T08:00:00Z"))).toEqual({
			claimed: 0,
			delivered: 0,
			failed: 0,
		});
	});

	it("delivers each schedule once even when the dispatcher is repeated", async () => {
		const env = createMailEnv();
		const task = await createCalendarTask(env, sessionUser(fixtureIds.owner), {
			title: "Review launch checklist",
		});
		const reminder = await createCalendarReminder(env, sessionUser(fixtureIds.owner), {
			taskId: task.id,
			remindAt: "2026-09-13T08:00:00Z",
		});
		const runAt = new Date("2026-09-13T08:01:00Z");

		expect(await dispatchDueCalendarReminders(env, runAt)).toEqual({
			claimed: 1,
			delivered: 1,
			failed: 0,
		});
		expect(await dispatchDueCalendarReminders(env, runAt)).toEqual({
			claimed: 0,
			delivered: 0,
			failed: 0,
		});
		const deliveries = await listCalendarReminderDeliveries(env, fixtureIds.owner, reminder.id);
		expect(deliveries).toHaveLength(1);
		expect(deliveries[0]).toMatchObject({ channel: "in_app", status: "delivered" });
	});

	it("does not deliver a snoozed reminder before its replacement schedule", async () => {
		const env = createMailEnv();
		const task = await createCalendarTask(env, sessionUser(fixtureIds.owner), {
			title: "Call supplier",
		});
		const reminder = await createCalendarReminder(env, sessionUser(fixtureIds.owner), {
			taskId: task.id,
			remindAt: "2026-09-13T08:00:00Z",
		});
		await snoozeCalendarReminder(
			env,
			fixtureIds.owner,
			reminder.id,
			"2026-09-13T10:00:00Z",
			new Date("2026-09-13T08:01:00Z"),
		);

		expect(await dispatchDueCalendarReminders(env, new Date("2026-09-13T09:59:59Z"))).toEqual({
			claimed: 0,
			delivered: 0,
			failed: 0,
		});
		expect(await dispatchDueCalendarReminders(env, new Date("2026-09-13T10:00:00Z"))).toEqual({
			claimed: 1,
			delivered: 1,
			failed: 0,
		});
	});

	it("queues one email reminder and preserves one durable delivery record", async () => {
		const queueSend = vi.fn(async () => undefined);
		const env = createMailEnv({
			OUTBOUND_QUEUE: { send: queueSend } as unknown as Queue,
		});
		const task = await createCalendarTask(env, sessionUser(fixtureIds.owner), {
			title: "Send agenda",
			mailboxId: fixtureIds.sharedMailbox,
		});
		const reminder = await createCalendarReminder(env, sessionUser(fixtureIds.owner), {
			taskId: task.id,
			channel: "email",
			mailboxId: fixtureIds.sharedMailbox,
			from: "support@primary.test",
			recipient: "owner@primary.test",
			remindAt: "2026-09-13T08:00:00Z",
		});

		await dispatchDueCalendarReminders(env, new Date("2026-09-13T08:01:00Z"));
		await dispatchDueCalendarReminders(env, new Date("2026-09-13T08:01:00Z"));

		expect(queueSend).toHaveBeenCalledTimes(1);
		const deliveries = await listCalendarReminderDeliveries(env, fixtureIds.owner, reminder.id);
		expect(deliveries).toHaveLength(1);
		expect(deliveries[0]).toMatchObject({ channel: "email", status: "queued" });
		expect(deliveries[0]?.outboundJobId).toBeTruthy();
		expect(deliveries[0]?.messageId).toBeTruthy();

		await setCalendarTaskCompleted(env, sessionUser(fixtureIds.owner), task.id, true);
		const outbound = await integrationEnv.DB.prepare(
			"SELECT status FROM outbound_jobs WHERE id = ?",
		)
			.bind(deliveries[0]?.outboundJobId)
			.first<{ status: string }>();
		expect(outbound?.status).toBe("canceled");
	});

	it("stops retrying after five failed email queue attempts", async () => {
		const env = createMailEnv();
		const task = await createCalendarTask(env, sessionUser(fixtureIds.owner), {
			title: "Escalate incident",
			mailboxId: fixtureIds.sharedMailbox,
		});
		const reminder = await createCalendarReminder(env, sessionUser(fixtureIds.owner), {
			taskId: task.id,
			channel: "email",
			mailboxId: fixtureIds.sharedMailbox,
			from: "support@primary.test",
			recipient: "owner@primary.test",
			remindAt: "2026-09-13T08:00:00Z",
		});
		const runAt = new Date("2026-09-13T08:01:00Z");

		for (let attempt = 0; attempt < 5; attempt += 1) {
			expect(await dispatchDueCalendarReminders(env, runAt)).toMatchObject({
				claimed: 1,
				failed: 1,
			});
		}
		expect(await dispatchDueCalendarReminders(env, runAt)).toEqual({
			claimed: 0,
			delivered: 0,
			failed: 0,
		});

		const [stored] = await listCalendarReminders(env, fixtureIds.owner, {
			status: "failed",
			due: false,
			start: null,
			end: null,
		});
		expect(stored).toMatchObject({ id: reminder.id, status: "failed", attemptCount: 5 });
		const deliveries = await listCalendarReminderDeliveries(env, fixtureIds.owner, reminder.id);
		expect(deliveries).toHaveLength(1);
		expect(deliveries[0]).toMatchObject({ status: "failed", attemptCount: 5 });
	});

	it("supports due filtering without exposing another account's reminders", async () => {
		const env = createMailEnv();
		const task = await createCalendarTask(env, sessionUser(fixtureIds.owner), {
			title: "Past due task",
		});
		await createCalendarReminder(env, sessionUser(fixtureIds.owner), {
			taskId: task.id,
			remindAt: "2026-09-13T08:00:00Z",
		});

		expect(
			await listCalendarReminders(env, fixtureIds.owner, {
				status: "all",
				due: true,
				start: null,
				end: null,
				now: new Date("2026-09-13T08:00:00Z"),
			}),
		).toHaveLength(1);
		expect(
			await listCalendarReminders(env, fixtureIds.stranger, {
				status: "all",
				due: true,
				start: null,
				end: null,
				now: new Date("2026-09-13T08:00:00Z"),
			}),
		).toEqual([]);
	});
});
