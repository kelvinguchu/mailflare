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
import {
	deleteExpiredWebhookDeliveries,
	dispatchWebhooks,
	listWebhookDeliveriesForUser,
	processWebhookQueue,
	redeliverWebhookForUser,
	WebhookRetryError,
} from "@/lib/email/webhooks";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
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
	it("routes exact and all-domain alias addresses without crossing owners", async () => {
		await seedMailboxWorld();
		const db = createDb(integrationEnv.DB);

		await expect(resolveInboundAddress(db, "Support <support@primary.test>"))
			.resolves.toMatchObject({ action: "store", mailbox: { mailboxId: fixtureIds.sharedMailbox } });
		await expect(resolveInboundAddress(db, "support@alias.test"))
			.resolves.toMatchObject({ action: "store", mailbox: { mailboxId: fixtureIds.sharedMailbox } });
		await expect(resolveInboundAddress(db, "missing@primary.test")).resolves.toBeNull();
	});

	it("makes an inbound retry converge on one D1 message, attachment row, and R2 object", async () => {
		await seedMailboxWorld();
		const raw = new TextEncoder().encode("From: sender@example.net\r\nTo: support@primary.test\r\n\r\nHello").buffer;
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
		expect(await commitInboundMessage(integrationEnv.DB, write, attachments))
			.toEqual({ created: true, messageId });
		const retryAttachments = await stageInboundMessageAttachments(
			integrationEnv,
			messageId,
			deliveryKey,
			[{ filename: "note.txt", type: "text/plain", content }],
		);
		expect(await commitInboundMessage(integrationEnv.DB, write, retryAttachments))
			.toEqual({ created: false, messageId });

		const messageCount = await integrationEnv.DB.prepare(
			"SELECT COUNT(*) AS count FROM messages WHERE inbound_delivery_key = ?",
		).bind(deliveryKey).first<{ count: number }>();
		const attachmentCount = await integrationEnv.DB.prepare(
			"SELECT COUNT(*) AS count FROM message_attachments WHERE message_id = ?",
		).bind(messageId).first<{ count: number }>();
		const storedObjects = await integrationEnv.BUCKET.list({ prefix: `attachments/inbound/${deliveryKey}/` });
		expect(messageCount?.count).toBe(1);
		expect(attachmentCount?.count).toBe(1);
		expect(storedObjects.objects).toHaveLength(1);
	});

	it("enforces shared-mailbox read and sender-identity permissions", async () => {
		await seedMailboxWorld();
		const db = createDb(integrationEnv.DB);
		await integrationEnv.DB.prepare(
			"INSERT INTO mailbox_access (id, mailbox_id, user_id, permission, created_at) VALUES (?, ?, ?, 'read_only', ?)",
		).bind("access_delegate", fixtureIds.sharedMailbox, fixtureIds.delegate, 1_700_000_000).run();

		const readOnly = await getMailboxAccessLevel(db, sessionUser(fixtureIds.delegate), fixtureIds.sharedMailbox);
		expect(readOnly).toMatchObject({ canRead: true, canSendOnBehalf: false, canManage: false });
		await expect(getAuthorizedSenderAddress(createMailEnv(), {
			userId: fixtureIds.delegate,
			mailboxId: fixtureIds.sharedMailbox,
			from: "support@primary.test",
		})).rejects.toThrow("permission");

		await integrationEnv.DB.prepare(
			"UPDATE mailbox_access SET permission = 'send_on_behalf' WHERE id = ?",
		).bind("access_delegate").run();
		await expect(getAuthorizedSenderAddress(createMailEnv(), {
			userId: fixtureIds.delegate,
			mailboxId: fixtureIds.sharedMailbox,
			from: "support@alias.test",
		})).resolves.toEqual({
			fromAddr: "\"Delegate on behalf of Support\" <support@alias.test>",
			mailboxId: fixtureIds.sharedMailbox,
		});

		await integrationEnv.DB.prepare(
			"UPDATE mailbox_access SET permission = 'send_as' WHERE id = ?",
		).bind("access_delegate").run();
		await expect(getAuthorizedSenderAddress(createMailEnv(), {
			userId: fixtureIds.delegate,
			mailboxId: fixtureIds.sharedMailbox,
			from: "support@primary.test",
		})).resolves.toEqual({
			fromAddr: "\"Support\" <support@primary.test>",
			mailboxId: fixtureIds.sharedMailbox,
		});
		await expect(getMailboxAccessLevel(db, sessionUser(fixtureIds.stranger), fixtureIds.sharedMailbox))
			.resolves.toBeNull();
	});

	it("retries a transient outbound failure once and never duplicates the durable job or delivery", async () => {
		await seedMailboxWorld();
		const queueSend = vi.fn(async () => undefined);
		const providerSend = vi.fn()
			.mockRejectedValueOnce(Object.assign(new Error("rate limited"), { code: "E_RATE_LIMIT_EXCEEDED" }))
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
			to: "recipient@example.net",
			subject: "Queued",
			text: "Once",
		};

		const first = await queueEmail(env, input, { idempotencyKey: "integration-send-1" });
		const replay = await queueEmail(env, input, { idempotencyKey: "integration-send-1" });
		expect(replay).toEqual(first);
		expect(queueSend).toHaveBeenCalledTimes(2);
		await expect(processOutboundQueue(env, { jobId: first.jobId }, { attempt: 1 }))
			.rejects.toBeInstanceOf(OutboundRetryError);
		await processOutboundQueue(env, { jobId: first.jobId }, { attempt: 2 });
		await processOutboundQueue(env, { jobId: first.jobId }, { attempt: 3 });

		const counts = await integrationEnv.DB.prepare(`SELECT
			(SELECT COUNT(*) FROM messages WHERE id = ?) AS messages,
			(SELECT COUNT(*) FROM outbound_jobs WHERE id = ?) AS jobs`
		).bind(first.messageId, first.jobId).first<{ messages: number; jobs: number }>();
		const job = await integrationEnv.DB.prepare(
			"SELECT status, attempt_count, error FROM outbound_jobs WHERE id = ?",
		).bind(first.jobId).first<{ status: string; attempt_count: number; error: string | null }>();
		expect(counts).toEqual({ messages: 1, jobs: 1 });
		expect(job).toEqual({ status: "sent", attempt_count: 2, error: null });
		expect(providerSend).toHaveBeenCalledTimes(2);
	});

	it("authorizes stored attachments and removes R2 objects when metadata persistence fails", async () => {
		await seedMailboxWorld();
		await integrationEnv.DB.prepare(
			"INSERT INTO mailbox_access (id, mailbox_id, user_id, permission, created_at) VALUES (?, ?, ?, 'read_only', ?)",
		).bind("access_reader", fixtureIds.sharedMailbox, fixtureIds.delegate, 1_700_000_000).run();
		await integrationEnv.DB.prepare(`INSERT INTO messages
			(id, user_id, mailbox_id, direction, from_addr, to_addr, status, created_at)
			VALUES (?, ?, ?, 'inbound', ?, ?, 'received', ?)`)
			.bind("msg_attachment", fixtureIds.owner, fixtureIds.sharedMailbox, "sender@example.net", "support@primary.test", 1_700_000_000)
			.run();
		const [stored] = await storeMessageAttachments(createMailEnv(), "msg_attachment", [{
			filename: "report.txt",
			type: "text/plain",
			content: new TextEncoder().encode("private").buffer,
		}]);
		expect(stored).toBeDefined();
		await expect(getAttachmentForUser(
			createMailEnv(),
			sessionUser(fixtureIds.delegate),
			"msg_attachment",
			stored!.id,
		)).resolves.toBeTruthy();
		await expect(getAttachmentForUser(
			createMailEnv(),
			sessionUser(fixtureIds.stranger),
			"msg_attachment",
			stored!.id,
		)).resolves.toBeNull();

		await expect(storeMessageAttachments(createMailEnv(), "missing_message", [{
			filename: "orphan.txt",
			type: "text/plain",
			content: new TextEncoder().encode("must be cleaned").buffer,
		}])).rejects.toThrow();
		const orphanObjects = await integrationEnv.BUCKET.list({ prefix: "attachments/missing_message/" });
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

		await sendMailboxAutoReply(env, { ...base, headers: {} });
		await sendMailboxAutoReply(env, { ...base, sourceMessageId: "msg_source_2", headers: {} });
		expect(queueSend).toHaveBeenCalledTimes(1);
		const counts = await integrationEnv.DB.prepare(`SELECT
			(SELECT COUNT(*) FROM auto_reply_deliveries) AS deliveries,
			(SELECT COUNT(*) FROM outbound_jobs) AS jobs`
		).first<{ deliveries: number; jobs: number }>();
		expect(counts).toEqual({ deliveries: 1, jobs: 1 });
	});

	it("queues signed webhooks, retries transient failures, deduplicates replay, and supports redelivery", async () => {
		await seedMailboxWorld();
		await integrationEnv.DB.prepare(`INSERT INTO webhooks
			(id, user_id, url, secret, events, enabled, created_at)
			VALUES (?, ?, ?, ?, ?, 1, ?)`)
			.bind(
				"hook_1",
				fixtureIds.owner,
				"https://hooks.example.test/mail",
				"integration-secret",
				JSON.stringify(["message.inbound"]),
				1_700_000_000,
			).run();
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

		await expect(dispatchWebhooks(env, fixtureIds.owner, "message.inbound", {
			messageId: "msg_webhook",
		})).resolves.toBeUndefined();
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(queued).toHaveLength(1);
		const deliveryId = queued[0]!.deliveryId;

		await expect(processWebhookQueue(env, { deliveryId })).rejects.toMatchObject({
			name: "WebhookRetryError",
			delaySeconds: 30,
		} satisfies Partial<WebhookRetryError>);
		let delivery = await integrationEnv.DB.prepare(
			"SELECT status, attempts, next_attempt_at, last_status_code, last_error FROM webhook_deliveries WHERE id = ?",
		).bind(deliveryId).first<{
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
		).bind(deliveryId).first();
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
		await expect(redeliverWebhookForUser(
			env,
			fixtureIds.stranger,
			"hook_1",
			deliveryId,
		)).resolves.toBe(false);
		await expect(redeliverWebhookForUser(
			env,
			fixtureIds.owner,
			"hook_1",
			deliveryId,
		)).resolves.toBe(true);
		expect(queueSend).toHaveBeenCalledTimes(2);

		await integrationEnv.DB.prepare(
			"UPDATE webhook_deliveries SET created_at = ? WHERE id = ?",
		).bind(1_600_000_000, deliveryId).run();
		await deleteExpiredWebhookDeliveries(env, new Date("2026-09-09T00:00:00Z"));
		const retained = await integrationEnv.DB.prepare(
			"SELECT COUNT(*) AS count FROM webhook_deliveries",
		).first<{ count: number }>();
		expect(retained?.count).toBe(0);
	});
});
