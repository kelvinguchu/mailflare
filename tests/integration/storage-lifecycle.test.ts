import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	requestPermanentMessageDeletion,
	runStorageLifecycleMaintenance,
} from "@/lib/storage/lifecycle";
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

describe("storage lifecycle", () => {
	it("permanently deletes trash from R2 before removing its D1 message", async () => {
		const rawKey = "inbound/delete-me.eml";
		const attachmentKey = "attachments/msg_delete/att_delete/report.txt";
		await integrationEnv.BUCKET.put(rawKey, "raw message");
		await integrationEnv.BUCKET.put(attachmentKey, "attachment");
		await integrationEnv.DB.batch([
			integrationEnv.DB.prepare(
				`INSERT INTO messages
				 (id, user_id, mailbox_id, direction, from_addr, to_addr, raw_r2_key, status, created_at)
				 VALUES (?, ?, ?, 'inbound', ?, ?, ?, 'trash', ?)`,
			).bind(
				"msg_delete",
				fixtureIds.owner,
				fixtureIds.sharedMailbox,
				"sender@example.net",
				"support@primary.test",
				rawKey,
				1_700_000_000,
			),
			integrationEnv.DB.prepare(
				`INSERT INTO message_attachments
				 (id, message_id, filename, content_type, size, r2_key, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			).bind(
				"att_delete",
				"msg_delete",
				"report.txt",
				"text/plain",
				10,
				attachmentKey,
				1_700_000_000,
			),
		]);

		const result = await requestPermanentMessageDeletion(
			createMailEnv(),
			sessionUser(fixtureIds.owner),
			"msg_delete",
		);
		expect(result).toMatchObject({ outcome: "accepted", completed: true });
		expect(await integrationEnv.BUCKET.head(rawKey)).toBeNull();
		expect(await integrationEnv.BUCKET.head(attachmentKey)).toBeNull();
		expect(
			await integrationEnv.DB.prepare("SELECT id FROM messages WHERE id = ?")
				.bind("msg_delete")
				.first(),
		).toBeNull();
		const job = await integrationEnv.DB.prepare(
			"SELECT status, attempt_count, last_error FROM storage_deletion_jobs WHERE message_id = ?",
		)
			.bind("msg_delete")
			.first<{ status: string; attempt_count: number; last_error: string | null }>();
		expect(job).toEqual({ status: "completed", attempt_count: 1, last_error: null });
		const audits = await integrationEnv.DB.prepare(
			"SELECT action, metadata FROM audit_logs WHERE metadata LIKE ? ORDER BY action",
		)
			.bind('%"messageId":"msg_delete"%')
			.all<{ action: string; metadata: string }>();
		expect(audits.results.map((item) => item.action)).toEqual([
			"email.permanent_delete_requested",
			"email.permanent_deleted",
		]);
	});

	it("keeps a failed R2 deletion observable and retries it safely", async () => {
		const rawKey = "inbound/retry-delete.eml";
		await integrationEnv.BUCKET.put(rawKey, "raw message");
		await integrationEnv.DB.prepare(
			`INSERT INTO messages
			 (id, user_id, mailbox_id, direction, from_addr, to_addr, raw_r2_key, status, created_at)
			 VALUES (?, ?, ?, 'inbound', ?, ?, ?, 'trash', ?)`,
		)
			.bind(
				"msg_retry_delete",
				fixtureIds.owner,
				fixtureIds.sharedMailbox,
				"sender@example.net",
				"support@primary.test",
				rawKey,
				1_700_000_000,
			)
			.run();
		const failingBucket = {
			delete: vi.fn(async () => {
				throw new Error("temporary R2 failure");
			}),
		} as Partial<R2Bucket> as R2Bucket;
		const result = await requestPermanentMessageDeletion(
			createMailEnv({ BUCKET: failingBucket }),
			sessionUser(fixtureIds.owner),
			"msg_retry_delete",
		);
		expect(result).toMatchObject({ outcome: "accepted", completed: false });
		let job = await integrationEnv.DB.prepare(
			`SELECT status, attempt_count, next_attempt_at, last_error
			 FROM storage_deletion_jobs WHERE message_id = ?`,
		)
			.bind("msg_retry_delete")
			.first<{
				status: string;
				attempt_count: number;
				next_attempt_at: number | null;
				last_error: string | null;
			}>();
		expect(job).toMatchObject({
			status: "failed",
			attempt_count: 1,
			last_error: "E_STORAGE_DELETION_FAILED",
		});
		expect(job?.next_attempt_at).toBeTypeOf("number");
		expect(await integrationEnv.BUCKET.head(rawKey)).not.toBeNull();

		await runStorageLifecycleMaintenance(createMailEnv(), new Date(Date.now() + 10 * 60 * 1_000));
		job = await integrationEnv.DB.prepare(
			`SELECT status, attempt_count, next_attempt_at, last_error
			 FROM storage_deletion_jobs WHERE message_id = ?`,
		)
			.bind("msg_retry_delete")
			.first();
		expect(job).toEqual({
			status: "completed",
			attempt_count: 2,
			next_attempt_at: null,
			last_error: null,
		});
		expect(await integrationEnv.BUCKET.head(rawKey)).toBeNull();
	});

	it("tracks trash age and removes only unreferenced mature R2 objects", async () => {
		await integrationEnv.DB.prepare(
			`INSERT INTO messages
			 (id, user_id, mailbox_id, direction, from_addr, to_addr, status, created_at)
			 VALUES (?, ?, ?, 'inbound', ?, ?, 'received', ?)`,
		)
			.bind(
				"msg_trash_clock",
				fixtureIds.owner,
				fixtureIds.sharedMailbox,
				"sender@example.net",
				"support@primary.test",
				1_700_000_000,
			)
			.run();
		await integrationEnv.DB.prepare("UPDATE messages SET status = 'trash' WHERE id = ?")
			.bind("msg_trash_clock")
			.run();
		const trashed = await integrationEnv.DB.prepare("SELECT trashed_at FROM messages WHERE id = ?")
			.bind("msg_trash_clock")
			.first<{ trashed_at: number | null }>();
		expect(trashed?.trashed_at).toBeTypeOf("number");
		await integrationEnv.DB.prepare("UPDATE messages SET status = 'received' WHERE id = ?")
			.bind("msg_trash_clock")
			.run();
		expect(
			await integrationEnv.DB.prepare("SELECT trashed_at FROM messages WHERE id = ?")
				.bind("msg_trash_clock")
				.first(),
		).toEqual({ trashed_at: null });

		const orphanKey = "attachments/interrupted/orphan.txt";
		await integrationEnv.BUCKET.put(orphanKey, "orphan");
		await runStorageLifecycleMaintenance(
			createMailEnv(),
			new Date(Date.now() + 2 * 24 * 60 * 60 * 1_000),
		);
		expect(await integrationEnv.BUCKET.head(orphanKey)).toBeNull();
	});
});
