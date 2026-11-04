import { parseCalendarInvitations } from "@/lib/calendar/ical";
import { confirmCalendarImport, findImportedEvent } from "@/lib/calendar/import";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	cancelCalendarReminder,
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
	updateCalendarTask,
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

	it("deduplicates confirmations, protects organizer identity/version, and cancels reminders", async () => {
		const env = createMailEnv();
		const user = sessionUser(fixtureIds.delegate);
		const meeting = parseCalendarInvitations(ics())[0];
		await expect(confirmCalendarImport(env, user, meeting, {})).rejects.toThrow("Confirm");
		const results = await Promise.all([
			confirmCalendarImport(env, user, meeting, { confirmed: true, addReminder: true }),
			confirmCalendarImport(env, user, meeting, { confirmed: true, addReminder: true }),
		]);
		expect(results[0].event.id).toBe(results[1].event.id);
		expect(
			await integrationEnv.DB.prepare("SELECT COUNT(*) AS count FROM calendar_events").first(),
		).toEqual({ count: 1 });
		expect(
			await integrationEnv.DB.prepare("SELECT COUNT(*) AS count FROM calendar_reminders").first(),
		).toEqual({ count: 1 });
		const update = parseCalendarInvitations(ics(1))[0];
		await expect(
			confirmCalendarImport(
				env,
				user,
				update,
				{ confirmed: true, expectedSequence: 0 },
				"forged@example.test",
			),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			confirmCalendarImport(env, user, update, { confirmed: true, expectedSequence: 9 }),
		).rejects.toMatchObject({ status: 409 });
		expect(
			(
				await confirmCalendarImport(
					env,
					user,
					update,
					{ confirmed: true, expectedSequence: 0 },
					"host@example.test",
				)
			).outcome,
		).toBe("updated");
		const forged = parseCalendarInvitations(ics(2, "other@example.test", "CANCEL"))[0];
		await expect(
			confirmCalendarImport(env, user, forged, { confirmed: true, expectedSequence: 1 }),
		).rejects.toMatchObject({ status: 404 });
		const cancellation = parseCalendarInvitations(ics(2, "host@example.test", "CANCEL"))[0];
		expect(
			(
				await confirmCalendarImport(
					env,
					user,
					cancellation,
					{ confirmed: true, expectedSequence: 1 },
					"host@example.test",
				)
			).outcome,
		).toBe("cancelled");
		expect(await findImportedEvent(env, user.id, meeting)).toMatchObject({
			importCancelled: true,
			sequence: 2,
		});
		expect((await confirmCalendarImport(env, user, meeting, { confirmed: true })).outcome).toBe(
			"unchanged",
		);
		expect(await dispatchDueCalendarReminders(env, new Date("2026-10-09T06:01:00Z"))).toMatchObject(
			{ delivered: 0 },
		);
	});
});

function ics(sequence = 0, organizer = "host@example.test", method = "REQUEST") {
	return [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		`METHOD:${method}`,
		"BEGIN:VEVENT",
		"UID:meeting-1",
		`ORGANIZER:mailto:${organizer}`,
		"SUMMARY:Team review",
		`SEQUENCE:${sequence}`,
		"DTSTART;TZID=Africa/Nairobi:20261009T090000",
		"DTEND;TZID=Africa/Nairobi:20261009T100000",
		"BEGIN:VALARM",
		"ACTION:DISPLAY",
		"TRIGGER:-PT15M",
		"DESCRIPTION:Reminder",
		"END:VALARM",
		"END:VEVENT",
		"END:VCALENDAR",
		"",
	].join("\r\n");
}

describe("repeating calendar tasks", () => {
	it("creates the next occurrence with its reminders once per completion", async () => {
		const env = createMailEnv();
		const owner = sessionUser(fixtureIds.owner);
		const delegate = sessionUser(fixtureIds.delegate);
		const task = await createCalendarTask(env, owner, {
			title: "Post standup notes",
			dueAt: "2030-01-07T09:00:00+03:00",
			timezone: "Africa/Nairobi",
			priority: "medium",
			assigneeUserId: fixtureIds.delegate,
			recurrenceRule: "FREQ=WEEKLY;BYDAY=WE,MO;COUNT=3",
		});
		expect(task).toMatchObject({
			recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3",
			recurrenceSeriesId: task.id,
			recurrenceIndex: 0,
		});
		await createCalendarReminder(env, owner, {
			taskId: task.id,
			remindAt: "2030-01-07T08:30:00+03:00",
			timezone: "Africa/Nairobi",
		});
		const dropped = await createCalendarReminder(env, delegate, {
			taskId: task.id,
			remindAt: "2030-01-07T07:00:00+03:00",
		});
		await cancelCalendarReminder(env, fixtureIds.delegate, dropped.id);

		const first = await setCalendarTaskCompleted(env, delegate, task.id, true);
		expect(first.status).toBe("completed");
		expect(first.nextTask).toMatchObject({
			title: "Post standup notes",
			status: "open",
			priority: "medium",
			creatorUserId: fixtureIds.owner,
			assigneeUserId: fixtureIds.delegate,
			dueAt: new Date("2030-01-09T06:00:00.000Z"),
			recurrenceRule: task.recurrenceRule,
			recurrenceSeriesId: task.id,
			recurrenceIndex: 1,
		});
		const nextId = first.nextTask!.id;
		const carried = await listCalendarReminders(env, fixtureIds.owner, {
			status: "all",
			due: false,
			taskId: nextId,
			start: null,
			end: null,
		});
		expect(carried).toHaveLength(1);
		expect(carried[0]).toMatchObject({
			status: "scheduled",
			remindAt: new Date("2030-01-09T05:30:00.000Z"),
		});
		expect(
			await listCalendarReminders(env, fixtureIds.delegate, {
				status: "all",
				due: false,
				taskId: nextId,
				start: null,
				end: null,
			}),
		).toEqual([]);

		await setCalendarTaskCompleted(env, delegate, task.id, false);
		const again = await setCalendarTaskCompleted(env, delegate, task.id, true);
		expect(again.nextTask?.id).toBe(nextId);
		const series = await integrationEnv.DB.prepare(
			"SELECT COUNT(*) AS count FROM calendar_tasks WHERE recurrence_series_id = ?",
		)
			.bind(task.id)
			.first<{ count: number }>();
		expect(series?.count).toBe(2);
		const reminderCount = await integrationEnv.DB.prepare(
			"SELECT COUNT(*) AS count FROM calendar_reminders WHERE task_id = ?",
		)
			.bind(nextId)
			.first<{ count: number }>();
		expect(reminderCount?.count).toBe(1);
		expect(
			(await listCalendarTaskActivity(env, delegate, nextId)).map((item) => item.action),
		).toEqual(["created"]);

		expect(await dispatchDueCalendarReminders(env, new Date("2030-01-09T05:31:00Z"))).toEqual({
			claimed: 1,
			delivered: 1,
			failed: 0,
		});

		const second = await setCalendarTaskCompleted(env, owner, nextId, true);
		expect(second.nextTask).toMatchObject({
			dueAt: new Date("2030-01-14T06:00:00.000Z"),
			recurrenceIndex: 2,
		});
		const last = await setCalendarTaskCompleted(env, owner, second.nextTask!.id, true);
		expect(last.nextTask).toBeNull();
	});

	it("validates repeat rules and restarts the series when the rule changes", async () => {
		const env = createMailEnv();
		const owner = sessionUser(fixtureIds.owner);
		await expect(
			createCalendarTask(env, owner, { title: "Water plants", recurrenceRule: "FREQ=DAILY" }),
		).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/due date/) });
		await expect(
			createCalendarTask(env, owner, {
				title: "Water plants",
				dueAt: "2030-01-07",
				allDay: true,
				recurrenceRule: "FREQ=MINUTELY",
			}),
		).rejects.toMatchObject({ status: 400 });

		const task = await createCalendarTask(env, owner, {
			title: "Water plants",
			dueAt: "2030-01-07",
			allDay: true,
			recurrenceRule: "FREQ=DAILY",
		});
		const { nextTask } = await setCalendarTaskCompleted(env, owner, task.id, true);
		expect(nextTask).toMatchObject({
			dueAt: new Date("2030-01-08T00:00:00.000Z"),
			allDay: true,
			recurrenceIndex: 1,
		});

		const changed = await updateCalendarTask(env, owner, nextTask!.id, {
			recurrenceRule: "FREQ=MONTHLY;COUNT=2",
		});
		expect(changed).toMatchObject({
			recurrenceRule: "FREQ=MONTHLY;BYMONTHDAY=8;COUNT=2",
			recurrenceSeriesId: nextTask!.id,
			recurrenceIndex: 0,
		});
		await expect(
			updateCalendarTask(env, owner, nextTask!.id, { dueAt: null }),
		).rejects.toMatchObject({ status: 400 });
		const stopped = await updateCalendarTask(env, owner, nextTask!.id, {
			dueAt: null,
			recurrenceRule: null,
		});
		expect(stopped).toMatchObject({ dueAt: null, recurrenceRule: null });
		expect((await setCalendarTaskCompleted(env, owner, nextTask!.id, true)).nextTask).toBeNull();
	});
});
