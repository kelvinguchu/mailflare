import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "@/db";
import { getAttachmentForUser, storeMessageAttachments } from "@/lib/email/attachments";
import { sendMailboxAutoReply } from "@/lib/email/auto-reply";
import {
	commitInboundMessage,
	createInboundDeliveryKey,
	createInboundMessageId,
} from "@/lib/email/inbound-idempotency";
import { stageInboundMessageAttachments } from "@/lib/email/inbound-attachments";
import { resolveInboundAddress } from "@/lib/email/routing";
import { getAuthorizedSenderAddress } from "@/lib/email/sender";
import { OutboundRetryError, processOutboundQueue, queueEmail } from "@/lib/email/send";
import { claimOutboundDelivery } from "@/lib/email/outbound-claim";
import { cancelScheduledOutboundJob } from "@/lib/email/undo-send";
import { resolveThreadAssignment } from "@/lib/email/threading";
import {
	deleteExpiredWebhookDeliveries,
	dispatchWebhooks,
	listWebhookDeliveriesForUser,
	processWebhookQueue,
	redeliverWebhookForUser,
	WebhookRetryError,
} from "@/lib/email/webhooks";
import { getMailboxAccessLevel, listAccessibleMailboxes } from "@/lib/mailboxes/access";
import { applyMessageBulkAction } from "@/app/api/messages/bulk/service";
import { listMessageThreads } from "@/app/api/messages/thread-list";
import { queryMessageCountAggregates } from "@/app/api/messages/counts/query";
import { buildMessageCountsFromAggregateRows } from "@/app/api/messages/counts/utils";
import { and, eq, lte } from "drizzle-orm";
import { messages } from "@/db/schema";
import { decodeMessagePageCursor } from "@/lib/messages/pagination";
import {
	createMailEnv,
	fixtureIds,
	resetIntegrationState,
	seedMailboxWorld,
	sessionUser,
} from "./fixtures";
import { integrationEnv } from "./bindings";

afterEach(() => {
	vi.unstubAllGlobals();
});

beforeEach(async () => {
	await resetIntegrationState();
});

describe("mail path with isolated Workers bindings", () => {
	it("assigns threads by reply headers before the guarded subject fallback", async () => {
		await seedMailboxWorld();
		const db = createDb(integrationEnv.DB);
		await integrationEnv.DB.batch([
			integrationEnv.DB.prepare(
				`INSERT INTO messages
				(id, user_id, mailbox_id, direction, provider_message_id, from_addr, to_addr,
				 subject, status, thread_id, created_at)
				VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, 'received', ?, ?)`,
			).bind(
				"msg_parent",
				fixtureIds.owner,
				fixtureIds.sharedMailbox,
				"<parent@example.net>",
				"maya@example.net",
				"support@primary.test",
				"Quarterly status",
				"thr_parent",
				1_787_900_000,
			),
			integrationEnv.DB.prepare(
				`INSERT INTO messages
				(id, user_id, mailbox_id, direction, provider_message_id, from_addr, to_addr,
				 subject, status, thread_id, created_at)
				VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, 'received', ?, ?)`,
			).bind(
				"msg_reference",
				fixtureIds.owner,
				fixtureIds.sharedMailbox,
				"<reference@example.net>",
				"maya@example.net",
				"support@primary.test",
				"Other",
				"thr_reference",
				1_787_900_010,
			),
		]);
		const createdAt = new Date(1_787_900_100 * 1_000);
		await expect(
			resolveThreadAssignment(db, {
				mailboxId: fixtureIds.sharedMailbox,
				inReplyTo: "parent@example.net",
				references: ["<reference@example.net>"],
				subject: "Unrelated",
				fromAddr: "maya@example.net",
				createdAt,
			}),
		).resolves.toEqual({ threadId: "thr_parent", replyToMessageId: "msg_parent" });
		await expect(
			resolveThreadAssignment(db, {
				mailboxId: fixtureIds.sharedMailbox,
				references: ["<parent@example.net>", "<reference@example.net>"],
				subject: "Unrelated",
				fromAddr: "maya@example.net",
				createdAt,
			}),
		).resolves.toEqual({ threadId: "thr_reference", replyToMessageId: "msg_reference" });
		await expect(
			resolveThreadAssignment(db, {
				mailboxId: fixtureIds.sharedMailbox,
				subject: "RE: Fwd: quarterly   status",
				fromAddr: "Maya <maya@example.net>",
				createdAt,
			}),
		).resolves.toEqual({ threadId: "thr_parent", replyToMessageId: "msg_parent" });

		const concurrent = await Promise.all(
			[1, 2].map(() =>
				resolveThreadAssignment(db, {
					mailboxId: fixtureIds.sharedMailbox,
					inReplyTo: "<parent@example.net>",
					fromAddr: "maya@example.net",
					createdAt,
				}),
			),
		);
		expect(new Set(concurrent.map((item) => item.threadId))).toEqual(new Set(["thr_parent"]));

		const outsideWindow = await resolveThreadAssignment(db, {
			mailboxId: fixtureIds.sharedMailbox,
			subject: "Quarterly status",
			fromAddr: "maya@example.net",
			createdAt: new Date(createdAt.getTime() + 31 * 24 * 60 * 60 * 1_000),
		});
		expect(outsideWindow.threadId).not.toBe("thr_parent");
		const crossMailbox = await resolveThreadAssignment(db, {
			mailboxId: fixtureIds.localMailbox,
			inReplyTo: "<parent@example.net>",
			fromAddr: "maya@example.net",
			createdAt,
		});
		expect(crossMailbox.threadId).not.toBe("thr_parent");
	});

	it("queues replies in the parent thread with provider-compatible headers", async () => {
		await seedMailboxWorld();
		await integrationEnv.DB.prepare(
			`INSERT INTO messages
			(id, user_id, mailbox_id, direction, provider_message_id, "references", from_addr,
			 to_addr, subject, status, thread_id, created_at)
			VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, 'received', ?, ?)`,
		)
			.bind(
				"msg_reply_parent",
				fixtureIds.owner,
				fixtureIds.sharedMailbox,
				"<parent@example.net>",
				JSON.stringify(["<root@example.net>"]),
				"maya@example.net",
				"support@primary.test",
				"Question",
				"thr_reply",
				1_787_900_000,
			)
			.run();
		const env = createMailEnv({
			OUTBOUND_QUEUE: { send: vi.fn(async () => undefined) } as unknown as Queue,
		});
		const queued = await queueEmail(
			env,
			{
				userId: fixtureIds.owner,
				mailboxId: fixtureIds.sharedMailbox,
				from: "support@primary.test",
				to: "maya@example.net",
				subject: "Re: Question",
				text: "Answer",
				replyToMessageId: "msg_reply_parent",
			},
			{ idempotencyKey: "threaded-reply" },
		);
		const row = await integrationEnv.DB.prepare(
			`SELECT thread_id, provider_message_id, in_reply_to, "references", reply_to_message_id
			 FROM messages WHERE id = ?`,
		)
			.bind(queued.messageId)
			.first<{
				thread_id: string;
				provider_message_id: string;
				in_reply_to: string;
				references: string;
				reply_to_message_id: string;
			}>();
		expect(row).toMatchObject({
			thread_id: "thr_reply",
			in_reply_to: "<parent@example.net>",
			reply_to_message_id: "msg_reply_parent",
		});
		expect(row?.provider_message_id).toMatch(/^<msg_.+@primary\.test>$/);
		expect(JSON.parse(row?.references ?? "[]")).toEqual([
			"<root@example.net>",
			"<parent@example.net>",
		]);
		const job = await integrationEnv.DB.prepare("SELECT payload FROM outbound_jobs WHERE id = ?")
			.bind(queued.jobId)
			.first<{ payload: string }>();
		expect(JSON.parse(job?.payload ?? "{}").headers).toMatchObject({
			"In-Reply-To": "<parent@example.net>",
			References: "<root@example.net> <parent@example.net>",
		});
		await expect(
			queueEmail(
				env,
				{
					userId: fixtureIds.owner,
					mailboxId: fixtureIds.localMailbox,
					from: "local@primary.test",
					to: "maya@example.net",
					subject: "Re: Question",
					text: "Wrong mailbox",
					replyToMessageId: "msg_reply_parent",
				},
				{ idempotencyKey: "cross-mailbox-reply" },
			),
		).rejects.toThrow("selected mailbox");
	});

	it("paginates matching threads by their newest visible message", async () => {
		await seedMailboxWorld();
		await integrationEnv.DB.batch([
			integrationEnv.DB.prepare(
				`INSERT INTO messages
				(id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status,
				 thread_id, read, created_at)
				VALUES (?, ?, ?, 'inbound', ?, ?, ?, 'received', ?, 0, ?)`,
			).bind(
				"msg_thread_old",
				fixtureIds.owner,
				fixtureIds.sharedMailbox,
				"maya@example.net",
				"support@primary.test",
				"Question",
				"thr_list_one",
				1_787_900_000,
			),
			integrationEnv.DB.prepare(
				`INSERT INTO messages
				(id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status,
				 thread_id, read, created_at)
				VALUES (?, ?, ?, 'outbound', ?, ?, ?, 'sent', ?, 1, ?)`,
			).bind(
				"msg_thread_reply",
				fixtureIds.owner,
				fixtureIds.sharedMailbox,
				"support@primary.test",
				"maya@example.net",
				"Re: Question",
				"thr_list_one",
				1_787_900_200,
			),
			integrationEnv.DB.prepare(
				`INSERT INTO messages
				(id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status,
				 thread_id, read, created_at)
				VALUES (?, ?, ?, 'inbound', ?, ?, ?, 'received', ?, 1, ?)`,
			).bind(
				"msg_thread_two",
				fixtureIds.owner,
				fixtureIds.sharedMailbox,
				"lin@example.net",
				"support@primary.test",
				"Another",
				"thr_list_two",
				1_787_900_100,
			),
		]);
		const db = createDb(integrationEnv.DB);
		const accessibleMailboxes = await listAccessibleMailboxes(db, sessionUser(fixtureIds.owner));
		const response = await listMessageThreads({
			env: createMailEnv(),
			matchingWhere: and(
				eq(messages.mailboxId, fixtureIds.sharedMailbox),
				eq(messages.status, "received"),
			),
			accessWhere: eq(messages.mailboxId, fixtureIds.sharedMailbox),
			accessibleMailboxes,
			includeTrash: false,
			includeSpam: false,
			limit: 1,
			offset: 0,
		});
		const data = (await response.json()) as {
			total: number;
			messages: Array<{
				id: string;
				read: boolean;
				thread: { id: string; messageCount: number; unreadCount: number };
			}>;
		};
		expect(data.total).toBe(2);
		expect(data.messages[0]).toMatchObject({
			id: "msg_thread_reply",
			read: false,
			thread: { id: "thr_list_one", messageCount: 2, unreadCount: 1 },
		});

		const snapshotAt = new Date(1_787_900_300 * 1_000);
		const firstCursorPage = await listMessageThreads({
			env: createMailEnv(),
			matchingWhere: and(
				eq(messages.mailboxId, fixtureIds.sharedMailbox),
				eq(messages.status, "received"),
			),
			accessWhere: eq(messages.mailboxId, fixtureIds.sharedMailbox),
			accessibleMailboxes,
			includeTrash: false,
			includeSpam: false,
			limit: 1,
			offset: 0,
			pagination: { snapshotAt },
		});
		const firstCursorData = (await firstCursorPage.json()) as {
			total: number;
			nextCursor: string;
			messages: Array<{ thread: { id: string } }>;
		};
		expect(firstCursorData.total).toBe(2);
		expect(firstCursorData.messages[0]?.thread.id).toBe("thr_list_one");

		await integrationEnv.DB.prepare(
			`INSERT INTO messages
			(id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status,
			 thread_id, read, created_at)
			VALUES ('msg_arrived_between_pages', ?, ?, 'inbound', 'new@example.net',
			 'support@primary.test', 'New arrival', 'received', 'thr_new_arrival', 0, ?)`,
		)
			.bind(fixtureIds.owner, fixtureIds.sharedMailbox, 1_787_900_400)
			.run();
		const decodedCursor = decodeMessagePageCursor(firstCursorData.nextCursor, "threads");
		const secondCursorPage = await listMessageThreads({
			env: createMailEnv(),
			matchingWhere: and(
				eq(messages.mailboxId, fixtureIds.sharedMailbox),
				eq(messages.status, "received"),
				lte(messages.createdAt, decodedCursor.snapshotAt),
			),
			accessWhere: eq(messages.mailboxId, fixtureIds.sharedMailbox),
			accessibleMailboxes,
			includeTrash: false,
			includeSpam: false,
			limit: 1,
			offset: 0,
			pagination: decodedCursor,
		});
		const secondCursorData = (await secondCursorPage.json()) as {
			messages: Array<{ thread: { id: string } }>;
		};
		expect(secondCursorData.messages.map((message) => message.thread.id)).toEqual(["thr_list_two"]);
	});

	it("aggregates message counts in D1 without returning every message row", async () => {
		await seedMailboxWorld();
		await integrationEnv.DB.batch([
			integrationEnv.DB.prepare(
				`INSERT INTO messages
				(id, user_id, mailbox_id, direction, from_addr, to_addr, status, thread_id,
				 read, starred, created_at)
				VALUES ('msg_count_1', ?, ?, 'inbound', 'maya@example.net', 'support@primary.test',
				 'received', 'thr_count', 0, 1, 1787900000)`,
			).bind(fixtureIds.owner, fixtureIds.sharedMailbox),
			integrationEnv.DB.prepare(
				`INSERT INTO messages
				(id, user_id, mailbox_id, direction, from_addr, to_addr, status, thread_id,
				 read, starred, created_at)
				VALUES ('msg_count_2', ?, ?, 'inbound', 'maya@example.net', 'support@primary.test',
				 'received', 'thr_count', 0, 0, 1787900010)`,
			).bind(fixtureIds.owner, fixtureIds.sharedMailbox),
		]);

		const messageCounts = buildMessageCountsFromAggregateRows(
			await queryMessageCountAggregates(
				integrationEnv.DB,
				{ mailboxId: fixtureIds.sharedMailbox },
				false,
			),
		);
		const threadCounts = buildMessageCountsFromAggregateRows(
			await queryMessageCountAggregates(
				integrationEnv.DB,
				{ mailboxId: fixtureIds.sharedMailbox },
				true,
			),
		);

		expect(messageCounts.folders.inbox).toEqual({ total: 2, unread: 2 });
		expect(messageCounts.folders.starred).toEqual({ total: 1, unread: 1 });
		expect(threadCounts.folders.inbox).toEqual({ total: 2, unread: 1 });
		expect(threadCounts.mailboxes).toEqual([
			{ mailboxId: fixtureIds.sharedMailbox, total: 2, unread: 1, inbox: 2 },
		]);
	});

	it("applies thread actions without archiving outbound replies", async () => {
		await seedMailboxWorld();
		await integrationEnv.DB.batch([
			integrationEnv.DB.prepare(
				`INSERT INTO messages
				(id, user_id, mailbox_id, direction, from_addr, to_addr, status, thread_id, read, created_at)
				VALUES ('msg_bulk_in_1', ?, ?, 'inbound', 'maya@example.net', 'support@primary.test',
				'received', 'thr_bulk', 0, 1787900000)`,
			).bind(fixtureIds.owner, fixtureIds.sharedMailbox),
			integrationEnv.DB.prepare(
				`INSERT INTO messages
				(id, user_id, mailbox_id, direction, from_addr, to_addr, status, thread_id, read, created_at)
				VALUES ('msg_bulk_out', ?, ?, 'outbound', 'support@primary.test', 'maya@example.net',
				'sent', 'thr_bulk', 1, 1787900010)`,
			).bind(fixtureIds.owner, fixtureIds.sharedMailbox),
			integrationEnv.DB.prepare(
				`INSERT INTO messages
				(id, user_id, mailbox_id, direction, from_addr, to_addr, status, thread_id, read, created_at)
				VALUES ('msg_bulk_in_2', ?, ?, 'inbound', 'maya@example.net', 'support@primary.test',
				'received', 'thr_bulk', 0, 1787900020)`,
			).bind(fixtureIds.owner, fixtureIds.sharedMailbox),
		]);
		const db = createDb(integrationEnv.DB);
		let rows = await db
			.select()
			.from(messages)
			.where(eq(messages.threadId, "thr_bulk"))
			.orderBy(messages.createdAt);
		await applyMessageBulkAction(db, rows.toReversed(), "unread", true);
		const unread = await integrationEnv.DB.prepare(
			"SELECT id FROM messages WHERE thread_id = 'thr_bulk' AND direction = 'inbound' AND read = 0",
		).all<{ id: string }>();
		expect(unread.results.map((row) => row.id)).toEqual(["msg_bulk_in_2"]);

		rows = await db.select().from(messages).where(eq(messages.threadId, "thr_bulk"));
		await applyMessageBulkAction(db, rows, "archive", true);
		const statuses = await integrationEnv.DB.prepare(
			"SELECT id, status FROM messages WHERE thread_id = 'thr_bulk' ORDER BY id",
		).all<{ id: string; status: string }>();
		expect(statuses.results).toEqual([
			{ id: "msg_bulk_in_1", status: "archived" },
			{ id: "msg_bulk_in_2", status: "archived" },
			{ id: "msg_bulk_out", status: "sent" },
		]);
	});
	it("routes exact and all-domain alias addresses without crossing owners", async () => {
		await seedMailboxWorld();
		const db = createDb(integrationEnv.DB);

		await expect(
			resolveInboundAddress(db, "Support <support@primary.test>"),
		).resolves.toMatchObject({ action: "store", mailbox: { mailboxId: fixtureIds.sharedMailbox } });
		await expect(resolveInboundAddress(db, "support@alias.test")).resolves.toMatchObject({
			action: "store",
			mailbox: { mailboxId: fixtureIds.sharedMailbox },
		});
		await expect(resolveInboundAddress(db, "missing@primary.test")).resolves.toBeNull();
	});

	it("makes an inbound retry converge on one D1 message, attachment row, and R2 object", async () => {
		await seedMailboxWorld();
		const raw = new TextEncoder().encode(
			"From: sender@example.net\r\nTo: support@primary.test\r\n\r\nHello",
		).buffer;
		const deliveryKey = await createInboundDeliveryKey(
			"sender@example.net",
			"support@primary.test",
			raw,
		);
		const messageId = createInboundMessageId(deliveryKey);
		const content = new TextEncoder().encode("attachment body").buffer;
		const attachments = await stageInboundMessageAttachments(
			integrationEnv,
			messageId,
			deliveryKey,
			[{ filename: "note.txt", type: "text/plain", content }],
		);
		const write = {
			id: messageId,
			deliveryKey,
			userId: fixtureIds.owner,
			mailboxId: fixtureIds.sharedMailbox,
			folderId: null,
			providerMessageId: null,
			fromAddr: "sender@example.net",
			toAddr: "support@primary.test",
			ccAddr: "copy@example.net",
			deliveredToAddr: "support@primary.test",
			subject: "Hello",
			snippet: "Hello",
			textBody: "Hello",
			htmlBody: null,
			rawR2Key: `raw/inbound/${deliveryKey}.eml`,
			status: "received" as const,
			threadId: null,
			createdAt: new Date("2026-09-09T00:00:00Z"),
		};

		await integrationEnv.BUCKET.put(write.rawR2Key, raw);
		expect(await commitInboundMessage(integrationEnv.DB, write, attachments)).toEqual({
			created: true,
			messageId,
		});
		const retryAttachments = await stageInboundMessageAttachments(
			integrationEnv,
			messageId,
			deliveryKey,
			[{ filename: "note.txt", type: "text/plain", content }],
		);
		expect(await commitInboundMessage(integrationEnv.DB, write, retryAttachments)).toEqual({
			created: false,
			messageId,
		});

		const messageCount = await integrationEnv.DB.prepare(
			"SELECT COUNT(*) AS count FROM messages WHERE inbound_delivery_key = ?",
		)
			.bind(deliveryKey)
			.first<{ count: number }>();
		const attachmentCount = await integrationEnv.DB.prepare(
			"SELECT COUNT(*) AS count FROM message_attachments WHERE message_id = ?",
		)
			.bind(messageId)
			.first<{ count: number }>();
		const storedObjects = await integrationEnv.BUCKET.list({
			prefix: `attachments/inbound/${deliveryKey}/`,
		});
		expect(messageCount?.count).toBe(1);
		const storedMessage = await integrationEnv.DB.prepare(
			"SELECT to_addr, cc_addr, delivered_to_addr FROM messages WHERE id = ?",
		)
			.bind(messageId)
			.first<{ to_addr: string; cc_addr: string; delivered_to_addr: string }>();
		expect(storedMessage).toEqual({
			to_addr: "support@primary.test",
			cc_addr: "copy@example.net",
			delivered_to_addr: "support@primary.test",
		});
		expect(attachmentCount?.count).toBe(1);
		expect(storedObjects.objects).toHaveLength(1);
	});

	it("enforces shared-mailbox read and sender-identity permissions", async () => {
		await seedMailboxWorld();
		const db = createDb(integrationEnv.DB);
		await integrationEnv.DB.prepare(
			"INSERT INTO mailbox_access (id, mailbox_id, user_id, permission, created_at) VALUES (?, ?, ?, 'read_only', ?)",
		)
			.bind("access_delegate", fixtureIds.sharedMailbox, fixtureIds.delegate, 1_700_000_000)
			.run();

		const readOnly = await getMailboxAccessLevel(
			db,
			sessionUser(fixtureIds.delegate),
			fixtureIds.sharedMailbox,
		);
		expect(readOnly).toMatchObject({ canRead: true, canSendOnBehalf: false, canManage: false });
		await expect(
			getAuthorizedSenderAddress(createMailEnv(), {
				userId: fixtureIds.delegate,
				mailboxId: fixtureIds.sharedMailbox,
				from: "support@primary.test",
			}),
		).rejects.toThrow("permission");

		await integrationEnv.DB.prepare(
			"UPDATE mailbox_access SET permission = 'send_on_behalf' WHERE id = ?",
		)
			.bind("access_delegate")
			.run();
		await expect(
			getAuthorizedSenderAddress(createMailEnv(), {
				userId: fixtureIds.delegate,
				mailboxId: fixtureIds.sharedMailbox,
				from: "support@alias.test",
			}),
		).resolves.toEqual({
			fromAddr: '"Delegate on behalf of Support" <support@alias.test>',
			mailboxId: fixtureIds.sharedMailbox,
			domainId: fixtureIds.aliasDomain,
		});

		await integrationEnv.DB.prepare("UPDATE mailbox_access SET permission = 'send_as' WHERE id = ?")
			.bind("access_delegate")
			.run();
		await expect(
			getAuthorizedSenderAddress(createMailEnv(), {
				userId: fixtureIds.delegate,
				mailboxId: fixtureIds.sharedMailbox,
				from: "support@primary.test",
			}),
		).resolves.toEqual({
			fromAddr: '"Support" <support@primary.test>',
			mailboxId: fixtureIds.sharedMailbox,
			domainId: fixtureIds.primaryDomain,
		});
		await expect(
			getMailboxAccessLevel(db, sessionUser(fixtureIds.stranger), fixtureIds.sharedMailbox),
		).resolves.toBeNull();
	});

	it("retries a transient outbound failure once and never duplicates the durable job or delivery", async () => {
		await seedMailboxWorld();
		const queueSend = vi.fn(async () => undefined);
		const providerSend = vi
			.fn()
			.mockRejectedValueOnce(
				Object.assign(new Error("rate limited"), { code: "E_RATE_LIMIT_EXCEEDED" }),
			)
			.mockResolvedValueOnce({ messageId: "provider-1" });
		const env = createMailEnv({
			OUTBOUND_QUEUE: { send: queueSend } as unknown as Queue,
			EMAIL: { send: providerSend } as unknown as SendEmail,
			OUTBOUND_DELIVERY_MODE: "enabled",
		});
		const input = {
			userId: fixtureIds.owner,
			mailboxId: fixtureIds.sharedMailbox,
			from: "support@primary.test",
			to: "Recipient <recipient@example.net>, second@example.net",
			cc: "copy@example.net, RECIPIENT@example.net",
			subject: "Queued",
			text: "Once",
		};

		const first = await queueEmail(env, input, { idempotencyKey: "integration-send-1" });
		const replay = await queueEmail(env, input, { idempotencyKey: "integration-send-1" });
		expect(replay).toEqual(first);
		expect(queueSend).toHaveBeenCalledTimes(2);
		await expect(
			processOutboundQueue(env, { jobId: first.jobId }, { attempt: 1 }),
		).rejects.toBeInstanceOf(OutboundRetryError);
		await processOutboundQueue(env, { jobId: first.jobId }, { attempt: 2 });
		await processOutboundQueue(env, { jobId: first.jobId }, { attempt: 3 });

		const counts = await integrationEnv.DB.prepare(
			`SELECT
			(SELECT COUNT(*) FROM messages WHERE id = ?) AS messages,
			(SELECT COUNT(*) FROM outbound_jobs WHERE id = ?) AS jobs`,
		)
			.bind(first.messageId, first.jobId)
			.first<{ messages: number; jobs: number }>();
		const job = await integrationEnv.DB.prepare(
			"SELECT status, attempt_count, error FROM outbound_jobs WHERE id = ?",
		)
			.bind(first.jobId)
			.first<{ status: string; attempt_count: number; error: string | null }>();
		expect(counts).toEqual({ messages: 1, jobs: 1 });
		expect(job).toEqual({ status: "sent", attempt_count: 2, error: null });
		expect(providerSend).toHaveBeenCalledTimes(2);
		expect(providerSend).toHaveBeenLastCalledWith(
			expect.objectContaining({
				to: [{ name: "Recipient", email: "recipient@example.net" }, "second@example.net"],
				cc: ["copy@example.net"],
			}),
		);
		const storedRecipients = await integrationEnv.DB.prepare(
			"SELECT to_addr, cc_addr FROM messages WHERE id = ?",
		)
			.bind(first.messageId)
			.first<{ to_addr: string; cc_addr: string }>();
		expect(storedRecipients).toEqual({
			to_addr: '"Recipient" <recipient@example.net>, second@example.net',
			cc_addr: "copy@example.net",
		});
	});

	it("cancels throughout the advertised Undo Send window without calling the provider", async () => {
		await seedMailboxWorld();
		const queueSend = vi.fn(async () => undefined);
		const providerSend = vi.fn(async () => ({ messageId: "must-not-send" }));
		const env = createMailEnv({
			OUTBOUND_QUEUE: { send: queueSend } as unknown as Queue,
			EMAIL: { send: providerSend } as unknown as SendEmail,
			OUTBOUND_DELIVERY_MODE: "enabled",
		});
		const scheduled = await queueEmail(
			env,
			{
				userId: fixtureIds.owner,
				mailboxId: fixtureIds.sharedMailbox,
				from: "support@primary.test",
				to: "recipient@example.net",
				subject: "Undo me",
				text: "Still editable",
			},
			{ idempotencyKey: "undo-send-success", undoDelaySeconds: 10 },
		);

		expect(scheduled).toMatchObject({ status: "scheduled" });
		expect(scheduled.undoDeadline).toBeTruthy();
		expect(queueSend).toHaveBeenCalledWith(
			{ jobId: scheduled.jobId },
			{ delaySeconds: expect.any(Number) },
		);
		await processOutboundQueue(env, { jobId: scheduled.jobId }, { attempt: 1 });
		expect(providerSend).not.toHaveBeenCalled();

		await expect(
			cancelScheduledOutboundJob(env, fixtureIds.owner, scheduled.jobId),
		).resolves.toMatchObject({ outcome: "canceled", messageId: scheduled.messageId });
		await expect(
			cancelScheduledOutboundJob(env, fixtureIds.owner, scheduled.jobId),
		).resolves.toMatchObject({ outcome: "canceled" });
		await expect(
			cancelScheduledOutboundJob(env, fixtureIds.stranger, scheduled.jobId),
		).resolves.toEqual({ outcome: "not_found" });
		await processOutboundQueue(env, { jobId: scheduled.jobId }, { attempt: 2 });
		expect(providerSend).not.toHaveBeenCalled();

		const state = await integrationEnv.DB.prepare(
			`SELECT j.status, j.canceled_at, m.status AS message_status,
			        m.delivery_status
			 FROM outbound_jobs j JOIN messages m ON m.id = j.message_id
			 WHERE j.id = ?`,
		)
			.bind(scheduled.jobId)
			.first<{
				status: string;
				canceled_at: number | null;
				message_status: string;
				delivery_status: string;
			}>();
		expect(state).toMatchObject({
			status: "canceled",
			message_status: "canceled",
			delivery_status: "canceled",
		});
		expect(state?.canceled_at).toBeTypeOf("number");
	});

	it("stops advertising Undo as soon as the atomic provider claim wins", async () => {
		await seedMailboxWorld();
		const env = createMailEnv({
			OUTBOUND_QUEUE: { send: vi.fn(async () => undefined) } as unknown as Queue,
		});
		const scheduled = await queueEmail(
			env,
			{
				userId: fixtureIds.owner,
				mailboxId: fixtureIds.sharedMailbox,
				from: "support@primary.test",
				to: "recipient@example.net",
				subject: "Race",
				text: "Only one transition wins",
			},
			{ idempotencyKey: "undo-send-claim-wins", undoDelaySeconds: 10 },
		);
		const claimTime = new Date();
		await integrationEnv.DB.prepare("UPDATE outbound_jobs SET send_not_before = ? WHERE id = ?")
			.bind(Math.floor(claimTime.getTime() / 1_000), scheduled.jobId)
			.run();

		await expect(
			claimOutboundDelivery(integrationEnv.DB, scheduled.jobId, claimTime),
		).resolves.toBe(true);
		await expect(
			cancelScheduledOutboundJob(env, fixtureIds.owner, scheduled.jobId, claimTime),
		).resolves.toMatchObject({ outcome: "unavailable", status: "sending" });
	});

	it("atomically enforces configured send limits and audits the rejection", async () => {
		await seedMailboxWorld();
		await integrationEnv.DB.prepare("UPDATE users SET send_rate_limit_per_minute = 1 WHERE id = ?")
			.bind(fixtureIds.owner)
			.run();
		await integrationEnv.DB.prepare(
			"UPDATE domains SET send_rate_limit_per_minute = 1 WHERE id = ?",
		)
			.bind(fixtureIds.primaryDomain)
			.run();
		const env = createMailEnv({
			OUTBOUND_QUEUE: { send: vi.fn(async () => undefined) } as unknown as Queue,
		});
		const input = {
			userId: fixtureIds.owner,
			mailboxId: fixtureIds.sharedMailbox,
			from: "support@primary.test",
			to: "first@example.net",
			subject: "Limited",
			text: "First",
		};
		await queueEmail(env, input, { idempotencyKey: "limit-first" });
		await expect(
			queueEmail(env, { ...input, to: "second@example.net" }, { idempotencyKey: "limit-second" }),
		).rejects.toThrow("send rate limit");
		const rejected = await integrationEnv.DB.prepare(
			"SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'email.send_rejected'",
		).first<{ count: number }>();
		expect(rejected?.count).toBe(1);
	});

	it("refuses queued delivery after a mailbox is disabled", async () => {
		await seedMailboxWorld();
		const providerSend = vi.fn(async () => ({ messageId: "must-not-send" }));
		const env = createMailEnv({
			OUTBOUND_QUEUE: { send: vi.fn(async () => undefined) } as unknown as Queue,
			EMAIL: { send: providerSend } as unknown as SendEmail,
			OUTBOUND_DELIVERY_MODE: "enabled",
		});
		const queued = await queueEmail(
			env,
			{
				userId: fixtureIds.owner,
				mailboxId: fixtureIds.sharedMailbox,
				from: "support@primary.test",
				to: "recipient@example.net",
				subject: "Queued",
				text: "Body",
			},
			{ idempotencyKey: "disable-before-delivery" },
		);
		await integrationEnv.DB.prepare("UPDATE mailboxes SET disabled = 1 WHERE id = ?")
			.bind(fixtureIds.sharedMailbox)
			.run();
		await processOutboundQueue(env, { jobId: queued.jobId }, { attempt: 1 });
		expect(providerSend).not.toHaveBeenCalled();
		const message = await integrationEnv.DB.prepare(
			"SELECT status, delivery_status FROM messages WHERE id = ?",
		)
			.bind(queued.messageId)
			.first<{ status: string; delivery_status: string }>();
		expect(message).toEqual({ status: "failed", delivery_status: "failed" });
	});

	it("suppresses a recipient after the provider reports a hard suppression", async () => {
		await seedMailboxWorld();
		const providerSend = vi.fn(async () => {
			throw Object.assign(new Error("suppressed"), { code: "E_RECIPIENT_SUPPRESSED" });
		});
		const env = createMailEnv({
			OUTBOUND_QUEUE: { send: vi.fn(async () => undefined) } as unknown as Queue,
			EMAIL: { send: providerSend } as unknown as SendEmail,
			OUTBOUND_DELIVERY_MODE: "enabled",
		});
		const input = {
			userId: fixtureIds.owner,
			mailboxId: fixtureIds.sharedMailbox,
			from: "support@primary.test",
			to: "hard-bounce@example.net",
			subject: "Test",
			text: "Body",
		};
		const queued = await queueEmail(env, input, { idempotencyKey: "hard-bounce-first" });
		await processOutboundQueue(env, { jobId: queued.jobId }, { attempt: 1 });
		await expect(queueEmail(env, input, { idempotencyKey: "hard-bounce-second" })).rejects.toThrow(
			"Recipient is suppressed",
		);
		const contact = await integrationEnv.DB.prepare("SELECT blocked FROM contacts WHERE email = ?")
			.bind("hard-bounce@example.net")
			.first<{ blocked: number }>();
		expect(contact?.blocked).toBe(1);
	});

	it("authorizes stored attachments and removes R2 objects when metadata persistence fails", async () => {
		await seedMailboxWorld();
		await integrationEnv.DB.prepare(
			"INSERT INTO mailbox_access (id, mailbox_id, user_id, permission, created_at) VALUES (?, ?, ?, 'read_only', ?)",
		)
			.bind("access_reader", fixtureIds.sharedMailbox, fixtureIds.delegate, 1_700_000_000)
			.run();
		await integrationEnv.DB.prepare(
			`INSERT INTO messages
			(id, user_id, mailbox_id, direction, from_addr, to_addr, status, created_at)
			VALUES (?, ?, ?, 'inbound', ?, ?, 'received', ?)`,
		)
			.bind(
				"msg_attachment",
				fixtureIds.owner,
				fixtureIds.sharedMailbox,
				"sender@example.net",
				"support@primary.test",
				1_700_000_000,
			)
			.run();
		const [stored] = await storeMessageAttachments(createMailEnv(), "msg_attachment", [
			{
				filename: "report.txt",
				type: "text/plain",
				content: new TextEncoder().encode("private").buffer,
			},
		]);
		expect(stored).toBeDefined();
		await expect(
			getAttachmentForUser(
				createMailEnv(),
				sessionUser(fixtureIds.delegate),
				"msg_attachment",
				stored!.id,
			),
		).resolves.toBeTruthy();
		await expect(
			getAttachmentForUser(
				createMailEnv(),
				sessionUser(fixtureIds.stranger),
				"msg_attachment",
				stored!.id,
			),
		).resolves.toBeNull();

		await expect(
			storeMessageAttachments(createMailEnv(), "missing_message", [
				{
					filename: "orphan.txt",
					type: "text/plain",
					content: new TextEncoder().encode("must be cleaned").buffer,
				},
			]),
		).rejects.toThrow();
		const orphanObjects = await integrationEnv.BUCKET.list({
			prefix: "attachments/missing_message/",
		});
		expect(orphanObjects.objects).toHaveLength(0);
	});

	it("suppresses auto-reply loops and throttles repeat recipients", async () => {
		await seedMailboxWorld();
		const queueSend = vi.fn(async () => undefined);
		const env = createMailEnv({ OUTBOUND_QUEUE: { send: queueSend } as unknown as Queue });
		const base = {
			userId: fixtureIds.owner,
			mailboxId: fixtureIds.sharedMailbox,
			deliveredAddress: "support@primary.test",
			fromAddress: "sender@example.net",
			sourceMessageId: "msg_source_1",
			incomingMessageId: "<source-1@example.net>",
		};

		await sendMailboxAutoReply(env, { ...base, headers: { "Auto-Submitted": "auto-generated" } });
		await sendMailboxAutoReply(env, { ...base, fromAddress: "local@primary.test", headers: {} });
		expect(queueSend).not.toHaveBeenCalled();
		await integrationEnv.DB.prepare(
			`INSERT INTO messages
			(id, user_id, mailbox_id, direction, provider_message_id, from_addr, to_addr,
			 subject, status, thread_id, created_at)
			VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, 'received', ?, ?)`,
		)
			.bind(
				base.sourceMessageId,
				fixtureIds.owner,
				fixtureIds.sharedMailbox,
				base.incomingMessageId,
				base.fromAddress,
				base.deliveredAddress,
				"Incoming",
				"thr_auto_reply",
				1_787_900_000,
			)
			.run();

		await sendMailboxAutoReply(env, { ...base, headers: {} });
		await sendMailboxAutoReply(env, { ...base, sourceMessageId: "msg_source_2", headers: {} });
		expect(queueSend).toHaveBeenCalledTimes(1);
		const counts = await integrationEnv.DB.prepare(
			`SELECT
			(SELECT COUNT(*) FROM auto_reply_deliveries) AS deliveries,
			(SELECT COUNT(*) FROM outbound_jobs) AS jobs`,
		).first<{ deliveries: number; jobs: number }>();
		expect(counts).toEqual({ deliveries: 1, jobs: 1 });
	});

	it("queues signed webhooks, retries transient failures, deduplicates replay, and supports redelivery", async () => {
		await seedMailboxWorld();
		await integrationEnv.DB.prepare(
			`INSERT INTO webhooks
			(id, user_id, url, secret, events, enabled, created_at)
			VALUES (?, ?, ?, ?, ?, 1, ?)`,
		)
			.bind(
				"hook_1",
				fixtureIds.owner,
				"https://hooks.example.test/mail",
				"integration-secret",
				JSON.stringify(["message.inbound"]),
				1_700_000_000,
			)
			.run();
		const queued: Array<{ deliveryId: string }> = [];
		const queueSend = vi.fn(async (message: { deliveryId: string }) => {
			queued.push(message);
		});
		const env = createMailEnv({ WEBHOOK_QUEUE: { send: queueSend } as unknown as Queue });
		let fetchAttempt = 0;
		const fetchSpy = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
			void args;
			fetchAttempt += 1;
			return fetchAttempt === 1
				? new Response("retry", { status: 503 })
				: new Response(null, { status: 204 });
		});
		vi.stubGlobal("fetch", fetchSpy);

		await expect(
			dispatchWebhooks(env, fixtureIds.owner, "message.inbound", {
				messageId: "msg_webhook",
			}),
		).resolves.toBeUndefined();
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(queued).toHaveLength(1);
		const deliveryId = queued[0]!.deliveryId;

		await expect(processWebhookQueue(env, { deliveryId })).rejects.toMatchObject({
			name: "WebhookRetryError",
			delaySeconds: 30,
		} satisfies Partial<WebhookRetryError>);
		let delivery = await integrationEnv.DB.prepare(
			"SELECT status, attempts, next_attempt_at, last_status_code, last_error FROM webhook_deliveries WHERE id = ?",
		)
			.bind(deliveryId)
			.first<{
				status: string;
				attempts: number;
				next_attempt_at: number | null;
				last_status_code: number | null;
				last_error: string | null;
			}>();
		expect(delivery).toMatchObject({
			status: "failed",
			attempts: 1,
			last_status_code: 503,
			last_error: "E_WEBHOOK_HTTP_503",
		});
		expect(delivery?.next_attempt_at).toBeTypeOf("number");

		await processWebhookQueue(env, { deliveryId });
		await processWebhookQueue(env, { deliveryId });
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		delivery = await integrationEnv.DB.prepare(
			"SELECT status, attempts, next_attempt_at, last_status_code, last_error FROM webhook_deliveries WHERE id = ?",
		)
			.bind(deliveryId)
			.first();
		expect(delivery).toEqual({
			status: "delivered",
			attempts: 2,
			next_attempt_at: null,
			last_status_code: 204,
			last_error: null,
		});

		const [, init] = fetchSpy.mock.calls[0]!;
		const body = String(init?.body);
		expect(JSON.parse(body)).toMatchObject({
			id: deliveryId,
			type: "message.inbound",
			createdAt: expect.any(String),
			data: { messageId: "msg_webhook" },
		});
		const key = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode("integration-secret"),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
		const expectedSignature = [...new Uint8Array(digest)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("");
		expect(new Headers(init?.headers).get("X-Email-Platform-Signature")).toBe(expectedSignature);
		expect(new Headers(init?.headers).get("X-Email-Platform-Delivery")).toBe(deliveryId);
		expect(fetchSpy.mock.calls[1]?.[1]?.body).toBe(body);

		const history = await listWebhookDeliveriesForUser(env, fixtureIds.owner, "hook_1");
		expect(history).toHaveLength(1);
		expect(history[0]).toMatchObject({ id: deliveryId, status: "delivered", attempts: 2 });
		await expect(
			redeliverWebhookForUser(env, fixtureIds.stranger, "hook_1", deliveryId),
		).resolves.toBe(false);
		await expect(
			redeliverWebhookForUser(env, fixtureIds.owner, "hook_1", deliveryId),
		).resolves.toBe(true);
		expect(queueSend).toHaveBeenCalledTimes(2);

		await integrationEnv.DB.prepare("UPDATE webhook_deliveries SET created_at = ? WHERE id = ?")
			.bind(1_600_000_000, deliveryId)
			.run();
		await deleteExpiredWebhookDeliveries(env, new Date("2026-09-09T00:00:00Z"));
		const retained = await integrationEnv.DB.prepare(
			"SELECT COUNT(*) AS count FROM webhook_deliveries",
		).first<{ count: number }>();
		expect(retained?.count).toBe(0);
	});
});
