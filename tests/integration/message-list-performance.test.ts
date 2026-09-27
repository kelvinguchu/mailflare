import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, lte } from "drizzle-orm";
import { createDb } from "@/db";
import { messages } from "@/db/schema";
import { queryMessageCountAggregates } from "@/app/api/messages/counts/query";
import { listMessageThreads } from "@/app/api/messages/thread-list";
import { decodeMessagePageCursor } from "@/lib/messages/pagination";
import { listAccessibleMailboxes } from "@/lib/mailboxes/access";
import {
	createMailEnv,
	fixtureIds,
	resetIntegrationState,
	seedMailboxWorld,
	sessionUser,
} from "./fixtures";
import { integrationEnv } from "./bindings";

const MESSAGE_COUNT = 5_000;

beforeEach(async () => {
	await resetIntegrationState();
	await seedMailboxWorld();
}, 30_000);

describe("message list performance", () => {
	it("keeps counts, thread pages, inbox pages, and mailbox switches bounded at scale", async () => {
		await seedMessages(MESSAGE_COUNT);
		const db = createDb(integrationEnv.DB);
		const accessibleMailboxes = await listAccessibleMailboxes(db, sessionUser(fixtureIds.owner));
		const snapshotAt = new Date(1_900_000_000 * 1_000);

		const countsStartedAt = performance.now();
		const allCounts = await queryMessageCountAggregates(
			integrationEnv.DB,
			{ accessibleMailboxIds: [fixtureIds.sharedMailbox, fixtureIds.localMailbox] },
			true,
		);
		const countsDurationMs = performance.now() - countsStartedAt;
		expect(allCounts.find((row) => row.scope === "mailbox")?.total).toBeGreaterThan(0);

		const threadsStartedAt = performance.now();
		const firstPage = await listMessageThreads({
			env: createMailEnv(),
			matchingWhere: and(
				eq(messages.mailboxId, fixtureIds.sharedMailbox),
				eq(messages.status, "received"),
				lte(messages.createdAt, snapshotAt),
			),
			accessWhere: eq(messages.mailboxId, fixtureIds.sharedMailbox),
			accessibleMailboxes,
			includeTrash: false,
			includeSpam: false,
			limit: 25,
			offset: 0,
			pagination: { snapshotAt },
		});
		const firstPageData = (await firstPage.json()) as {
			messages: Array<{ thread: { id: string } }>;
			nextCursor: string;
		};
		const cursor = decodeMessagePageCursor(firstPageData.nextCursor, "threads");
		const secondPage = await listMessageThreads({
			env: createMailEnv(),
			matchingWhere: and(
				eq(messages.mailboxId, fixtureIds.sharedMailbox),
				eq(messages.status, "received"),
				lte(messages.createdAt, cursor.snapshotAt),
			),
			accessWhere: eq(messages.mailboxId, fixtureIds.sharedMailbox),
			accessibleMailboxes,
			includeTrash: false,
			includeSpam: false,
			limit: 25,
			offset: 0,
			pagination: cursor,
		});
		const secondPageData = (await secondPage.json()) as {
			messages: Array<{ thread: { id: string } }>;
		};
		const threadsDurationMs = performance.now() - threadsStartedAt;
		expect(firstPageData.messages).toHaveLength(25);
		expect(secondPageData.messages).toHaveLength(25);
		expect(
			new Set([
				...firstPageData.messages.map((message) => message.thread.id),
				...secondPageData.messages.map((message) => message.thread.id),
			]).size,
		).toBe(50);

		const inboxStartedAt = performance.now();
		const inboxPage = await integrationEnv.DB.prepare(
			`SELECT id, created_at
			 FROM messages
			 WHERE mailbox_id = ? AND status = 'received' AND direction = 'inbound'
			   AND folder_id IS NULL AND created_at <= ?
			 ORDER BY created_at DESC, id DESC LIMIT 26`,
		)
			.bind(fixtureIds.sharedMailbox, Math.floor(snapshotAt.getTime() / 1_000))
			.all<{ id: string; created_at: number }>();
		const inboxDurationMs = performance.now() - inboxStartedAt;
		expect(inboxPage.results).toHaveLength(26);

		const switchStartedAt = performance.now();
		await queryMessageCountAggregates(
			integrationEnv.DB,
			{ mailboxId: fixtureIds.sharedMailbox },
			true,
		);
		await queryMessageCountAggregates(
			integrationEnv.DB,
			{ mailboxId: fixtureIds.localMailbox },
			true,
		);
		const switchDurationMs = performance.now() - switchStartedAt;

		const metrics = {
			messages: MESSAGE_COUNT,
			countsDurationMs: Math.round(countsDurationMs),
			threadsDurationMs: Math.round(threadsDurationMs),
			inboxDurationMs: Math.round(inboxDurationMs),
			switchDurationMs: Math.round(switchDurationMs),
		};
		console.info("message-list-load-test", metrics);
		expect(metrics).toMatchObject({ messages: MESSAGE_COUNT });
		expect(countsDurationMs).toBeLessThan(3_000);
		expect(threadsDurationMs).toBeLessThan(5_000);
		expect(inboxDurationMs).toBeLessThan(2_000);
		expect(switchDurationMs).toBeLessThan(3_000);
	});

	it("uses compound indexes for the hot list plans", async () => {
		const inboxPlan = await explainPlan(
			`SELECT id FROM messages
			 WHERE mailbox_id = 'plan-mailbox' AND status = 'received' AND direction = 'inbound'
			   AND folder_id IS NULL
			 ORDER BY created_at DESC, id DESC LIMIT 26`,
		);
		const folderPlan = await explainPlan(
			`SELECT id FROM messages
			 WHERE mailbox_id = 'plan-mailbox' AND folder_id = 'plan-folder'
			 ORDER BY created_at DESC, id DESC LIMIT 26`,
		);
		const statusPlan = await explainPlan(
			`SELECT id FROM messages
			 WHERE mailbox_id = 'plan-mailbox' AND status = 'trash'
			 ORDER BY created_at DESC, id DESC LIMIT 26`,
		);
		const unreadPlan = await explainPlan(
			`SELECT id FROM messages
			 WHERE mailbox_id = 'plan-mailbox' AND read = 0
			 ORDER BY created_at DESC, id DESC LIMIT 26`,
		);
		const threadPlan = await explainPlan(
			`SELECT coalesce(thread_id, id) AS thread_key, max(created_at) AS last_message_at
			 FROM messages WHERE mailbox_id = 'plan-mailbox'
			 GROUP BY coalesce(thread_id, id)
			 ORDER BY last_message_at DESC, thread_key DESC LIMIT 26`,
		);

		expect(inboxPlan).toContain("messages_mailbox_folder_created_id_idx");
		expect(folderPlan).toContain("messages_mailbox_folder_created_id_idx");
		expect(statusPlan).toContain("messages_mailbox_status_created_id_idx");
		expect(unreadPlan).toContain("messages_mailbox_read_created_id_idx");
		expect(threadPlan).toContain("messages_mailbox_thread_key_created_id_idx");
		expect(inboxPlan).not.toContain("TEMP B-TREE FOR ORDER BY");
		expect(folderPlan).not.toContain("TEMP B-TREE FOR ORDER BY");
		expect(statusPlan).not.toContain("TEMP B-TREE FOR ORDER BY");
		expect(unreadPlan).not.toContain("TEMP B-TREE FOR ORDER BY");
		expect(threadPlan).not.toContain("TEMP B-TREE FOR GROUP BY");
	});
});

async function seedMessages(count: number): Promise<void> {
	await integrationEnv.DB.prepare(
		`WITH RECURSIVE sequence(value) AS (
			SELECT 0
			UNION ALL
			SELECT value + 1 FROM sequence WHERE value + 1 < ?
		)
		INSERT INTO messages
			(id, user_id, mailbox_id, direction, from_addr, to_addr, status, thread_id,
			 read, starred, created_at)
		SELECT
			'msg_perf_' || printf('%05d', value),
			?,
			CASE WHEN value % 2 = 0 THEN ? ELSE ? END,
			'inbound',
			'sender' || value || '@example.net',
			CASE WHEN value % 2 = 0 THEN 'support@primary.test' ELSE 'local@primary.test' END,
			'received',
			'thr_perf_' || printf('%05d', CAST(value / 4 AS INTEGER)),
			CASE WHEN value % 3 = 0 THEN 0 ELSE 1 END,
			CASE WHEN value % 11 = 0 THEN 1 ELSE 0 END,
			1780000000 + value
		FROM sequence`,
	)
		.bind(count, fixtureIds.owner, fixtureIds.sharedMailbox, fixtureIds.localMailbox)
		.run();
}

async function explainPlan(query: string): Promise<string> {
	const result = await integrationEnv.DB.prepare(`EXPLAIN QUERY PLAN ${query}`).all<{
		detail: string;
	}>();
	return result.results.map((row) => row.detail).join("\n");
}
