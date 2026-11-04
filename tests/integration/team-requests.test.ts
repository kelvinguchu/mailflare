import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import {
	getAccountDomain,
	listAccountDomains,
	reserveAccountAddress,
} from "@/lib/accounts/admin-domains";
import { createCalendarTask, setCalendarTaskCompleted } from "@/lib/calendar/tasks";
import {
	createCalendarReminder,
	dispatchDueCalendarReminders,
	snoozeCalendarReminder,
	updateCalendarReminder,
} from "@/lib/calendar/reminders";
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

describe("team requests with isolated D1/R2 and a provider mock", () => {
	it("lets a second administrator provision on configured domains with race-safe conflicts", async () => {
		const env = createMailEnv();
		const db = getDb(env);
		await integrationEnv.DB.prepare("UPDATE users SET role='admin' WHERE id=?")
			.bind(fixtureIds.delegate)
			.run();
		const second = { ...sessionUser(fixtureIds.delegate), role: "admin" as const };
		expect((await listAccountDomains(db, second)).map((domain) => domain.id)).toEqual(
			expect.arrayContaining([fixtureIds.primaryDomain, fixtureIds.aliasDomain]),
		);
		expect(await getAccountDomain(db, second, "forged-zone")).toBeNull();
		expect(() => listAccountDomains(db, sessionUser(fixtureIds.stranger))).toThrow("Forbidden");
		const reserve = (creator: typeof second, username: string, suffix: string) =>
			reserveAccountAddress(
				db,
				creator,
				{
					id: `usr_${suffix}`,
					email: `${username}@primary.test`,
					name: username,
					passwordHash: "unusable",
					role: "user",
					activationStatus: "pending",
				},
				{
					id: `mbx_${suffix}`,
					userId: `usr_${suffix}`,
					domainId: fixtureIds.primaryDomain,
					localPart: username,
				},
			);
		const results = await Promise.allSettled([
			reserve(second, "newperson", "one"),
			reserve(second, "newperson", "two"),
		]);
		expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
		expect(
			await integrationEnv.DB.prepare(
				"SELECT created_by_user_id, activation_status FROM users WHERE email='newperson@primary.test'",
			).first(),
		).toEqual({ created_by_user_id: fixtureIds.delegate, activation_status: "pending" });
		expect(
			await integrationEnv.DB.prepare("SELECT user_id FROM domains WHERE id=?")
				.bind(fixtureIds.primaryDomain)
				.first(),
		).toEqual({ user_id: fixtureIds.owner });
		await reserve({ ...sessionUser(fixtureIds.owner), role: "admin" }, "anotherperson", "three");
		await expect(
			reserveAccountAddress(
				db,
				sessionUser(fixtureIds.stranger),
				{
					id: "forbidden",
					email: "forbidden@primary.test",
					name: "Forbidden",
					passwordHash: "unusable",
				},
				{
					id: "forbidden",
					userId: "forbidden",
					domainId: fixtureIds.primaryDomain,
					localPart: "forbidden",
				},
			),
		).rejects.toThrow("Forbidden");
		expect(
			await integrationEnv.DB.prepare(
				"SELECT COUNT(*) AS count FROM users WHERE email='newperson@primary.test'",
			).first(),
		).toEqual({ count: 1 });
	});
	it("supports personal tasks and in-app reminders without a mailbox and blocks disabled users", async () => {
		const env = createMailEnv();
		const user = sessionUser(fixtureIds.delegate);
		const task = await createCalendarTask(env, user, {
			title: "Personal task",
			timezone: "Africa/Nairobi",
		});
		const reminder = await createCalendarReminder(env, user, {
			taskId: task.id,
			remindAt: "2026-10-09T06:00:00Z",
		});
		expect(reminder.mailboxId).toBeNull();
		await expect(
			updateCalendarReminder(env, sessionUser(fixtureIds.stranger), reminder.id, {
				title: "Guessed ID",
			}),
		).rejects.toMatchObject({ status: 404 });
		expect(await dispatchDueCalendarReminders(env, new Date("2026-10-09T06:01:00Z"))).toMatchObject(
			{ delivered: 1 },
		);
		await snoozeCalendarReminder(
			env,
			user.id,
			reminder.id,
			"2026-10-09T07:00:00Z",
			new Date("2026-10-09T06:01:00Z"),
		);
		expect(await dispatchDueCalendarReminders(env, new Date("2026-10-09T06:30:00Z"))).toMatchObject(
			{ delivered: 0 },
		);
		await setCalendarTaskCompleted(env, user, task.id, true);
		expect(await dispatchDueCalendarReminders(env, new Date("2026-10-09T07:30:00Z"))).toMatchObject(
			{ delivered: 0 },
		);
		await expect(
			createCalendarTask(env, { ...user, disabled: true }, { title: "Disabled" }),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			createCalendarReminder(
				env,
				{ ...user, disabled: true },
				{ taskId: task.id, remindAt: "2026-10-10T06:00:00Z" },
			),
		).rejects.toMatchObject({ status: 403 });
	});
});
