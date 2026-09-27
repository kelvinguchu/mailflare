import { beforeEach, describe, expect, it } from "vitest";
import { and, desc } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import {
	getMessageAccessCondition,
	getMessageSearchConditions,
} from "@/app/api/messages/search-utils";
import { parseMessageSearchParams } from "@/lib/messages/search";
import { listAccessibleMailboxes } from "@/lib/mailboxes/access";
import { fixtureIds, resetIntegrationState, seedMailboxWorld, sessionUser } from "./fixtures";
import { integrationEnv } from "./bindings";

const baseCreatedAt = 1_750_000_000;

describe("indexed message search", () => {
	beforeEach(async () => {
		await resetIntegrationState();
		await seedMailboxWorld();
		await integrationEnv.DB.prepare(
			"INSERT INTO mailbox_access (id, mailbox_id, user_id, permission, created_at) VALUES (?, ?, ?, 'read_only', ?)",
		)
			.bind("access_search_delegate", fixtureIds.sharedMailbox, fixtureIds.delegate, baseCreatedAt)
			.run();
	});

	it("uses the FTS index and searches bodies without exposing inaccessible mailboxes", async () => {
		await insertMessage({
			id: "msg_visible_body",
			mailboxId: fixtureIds.sharedMailbox,
			from: "billing@vendor.test",
			to: "support@primary.test",
			subject: "Monthly statement",
			textBody: "The quarterly forecast is ready.",
			createdAt: baseCreatedAt,
		});
		await insertMessage({
			id: "msg_hidden_body",
			mailboxId: fixtureIds.localMailbox,
			from: "private@vendor.test",
			to: "local@primary.test",
			subject: "Private statement",
			textBody: "The quarterly forecast contains a hidden secret.",
			createdAt: baseCreatedAt + 1,
		});

		const plan = await integrationEnv.DB.prepare(
			"EXPLAIN QUERY PLAN SELECT message_id FROM message_search WHERE message_search MATCH ?",
		)
			.bind('"quarterly"')
			.all<{ detail: string }>();
		expect(plan.results.some((row) => /VIRTUAL TABLE INDEX/i.test(row.detail))).toBe(true);

		const rows = await searchAsDelegate(new URLSearchParams({ q: "quarterly" }));
		expect(rows.map((row) => row.id)).toEqual(["msg_visible_body"]);

		const accessible = await listAccessibleMailboxes(
			getDb(integrationEnv),
			sessionUser(fixtureIds.delegate),
		);
		const denied = getMessageAccessCondition(
			fixtureIds.delegate,
			accessible.map((mailbox) => mailbox.id),
			fixtureIds.localMailbox,
		);
		expect(denied.allowed).toBe(false);
	});

	it("treats FTS syntax as literal text", async () => {
		await insertMessage({
			id: "msg_operator_words",
			mailboxId: fixtureIds.sharedMailbox,
			from: "alerts@vendor.test",
			to: "support@primary.test",
			subject: "quarterly OR secret",
			textBody: "Literal operator-like words.",
			createdAt: baseCreatedAt,
		});
		await insertMessage({
			id: "msg_secret_only",
			mailboxId: fixtureIds.sharedMailbox,
			from: "alerts@vendor.test",
			to: "support@primary.test",
			subject: "secret",
			textBody: "This must not match an injected OR expression.",
			createdAt: baseCreatedAt + 1,
		});

		const rows = await searchAsDelegate(new URLSearchParams({ q: "quarterly OR secret" }));
		expect(rows.map((row) => row.id)).toEqual(["msg_operator_words"]);
	});

	it("combines sender, recipient, attachment, mailbox, date, and ordering filters", async () => {
		await insertMessage({
			id: "msg_old_invoice",
			mailboxId: fixtureIds.sharedMailbox,
			from: "billing@vendor.test",
			to: "finance@primary.test",
			subject: "Old invoice",
			textBody: "Invoice from last year.",
			createdAt: 1_700_000_000,
		});
		await insertMessage({
			id: "msg_new_invoice",
			mailboxId: fixtureIds.sharedMailbox,
			from: "billing@vendor.test",
			to: "support@primary.test",
			cc: "finance@primary.test",
			subject: "New invoice",
			textBody: "Current invoice.",
			createdAt: baseCreatedAt,
		});
		await integrationEnv.DB.prepare(
			`INSERT INTO message_attachments
			(id, message_id, filename, content_type, size, disposition, security_status, r2_key, created_at)
			VALUES (?, ?, ?, 'application/pdf', 123, 'attachment', 'safe', ?, ?)`,
		)
			.bind(
				"att_invoice",
				"msg_new_invoice",
				"quarterly-report.pdf",
				"attachments/quarterly-report.pdf",
				baseCreatedAt,
			)
			.run();

		const params = new URLSearchParams({
			q: "quarterly-report",
			from: "billing@vendor.test",
			to: "finance@primary.test",
			hasAttachments: "true",
			after: "2025-01-01",
			before: "2026-12-31",
		});
		const rows = await searchAsDelegate(params, fixtureIds.sharedMailbox);
		expect(rows.map((row) => row.id)).toEqual(["msg_new_invoice"]);

		await integrationEnv.DB.prepare(
			"UPDATE message_attachments SET filename = 'renamed-contract.pdf' WHERE id = ?",
		)
			.bind("att_invoice")
			.run();
		expect(
			(await searchAsDelegate(new URLSearchParams({ q: "renamed-contract" }))).map((row) => row.id),
		).toEqual(["msg_new_invoice"]);
	});

	it("keeps deterministic newest-first ordering", async () => {
		for (const [id, createdAt] of [
			["msg_first", baseCreatedAt],
			["msg_second", baseCreatedAt + 2],
			["msg_middle", baseCreatedAt + 1],
		] as const) {
			await insertMessage({
				id,
				mailboxId: fixtureIds.sharedMailbox,
				from: "billing@vendor.test",
				to: "support@primary.test",
				subject: "Indexed ordering",
				textBody: "Search benchmark marker.",
				createdAt,
			});
		}

		const rows = await searchAsDelegate(new URLSearchParams({ q: "benchmark" }));
		expect(rows.map((row) => row.id)).toEqual(["msg_second", "msg_middle", "msg_first"]);
	});

	it("rejects malformed filters before issuing a database query", () => {
		expect(() =>
			parseMessageSearchParams(new URLSearchParams({ q: "ab", hasAttachments: "yes" })),
		).toThrow();
	});

	it("benchmarks indexed search across a representative multi-year mailbox", async () => {
		const datasetSize = 20_000;
		await integrationEnv.DB.prepare(
			`WITH digits(value) AS (
				VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9)
			), generated(number) AS (
				SELECT ones.value + tens.value * 10 + hundreds.value * 100
					+ thousands.value * 1000 + ten_thousands.value * 10000
				FROM digits AS ones
				CROSS JOIN digits AS tens
				CROSS JOIN digits AS hundreds
				CROSS JOIN digits AS thousands
				CROSS JOIN digits AS ten_thousands
			)
			INSERT INTO messages
				(id, user_id, mailbox_id, direction, from_addr, to_addr, subject, snippet,
				 text_body, status, created_at)
			SELECT
				printf('benchmark_%05d', number),
				?,
				?,
				'inbound',
				'archive@vendor.test',
				'support@primary.test',
				CASE WHEN number = ? THEN 'Rare multi-year benchmark needle' ELSE 'Routine archive message' END,
				'Historical business correspondence',
				'Historical business correspondence retained for search verification.',
				'received',
				? - number * 8640
			FROM generated
			WHERE number < ?`,
		)
			.bind(fixtureIds.owner, fixtureIds.sharedMailbox, datasetSize - 1, baseCreatedAt, datasetSize)
			.run();

		const startedAt = performance.now();
		const rows = await searchAsDelegate(new URLSearchParams({ q: "benchmark needle" }));
		const elapsedMs = performance.now() - startedAt;

		expect(rows.map((row) => row.id)).toEqual(["benchmark_19999"]);
		console.info(
			`Indexed message search benchmark: ${datasetSize.toLocaleString()} messages in ${elapsedMs.toFixed(1)}ms`,
		);
	}, 30_000);
});

async function searchAsDelegate(params: URLSearchParams, mailboxId?: string) {
	const db = getDb(integrationEnv);
	const user = sessionUser(fixtureIds.delegate);
	const accessible = await listAccessibleMailboxes(db, user);
	const access = getMessageAccessCondition(
		user.id,
		accessible.map((mailbox) => mailbox.id),
		mailboxId,
	);
	if (!access.allowed) return [];
	const filters = parseMessageSearchParams(params);
	return db
		.select({ id: messages.id })
		.from(messages)
		.where(and(access.condition, ...getMessageSearchConditions(filters)))
		.orderBy(desc(messages.createdAt), desc(messages.id));
}

async function insertMessage(input: {
	id: string;
	mailboxId: string;
	from: string;
	to: string;
	cc?: string;
	subject: string;
	textBody: string;
	createdAt: number;
}) {
	await integrationEnv.DB.prepare(
		`INSERT INTO messages
		(id, user_id, mailbox_id, direction, from_addr, to_addr, cc_addr, subject, snippet, text_body, status, created_at)
		VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, 'received', ?)`,
	)
		.bind(
			input.id,
			fixtureIds.owner,
			input.mailboxId,
			input.from,
			input.to,
			input.cc ?? "",
			input.subject,
			input.textBody.slice(0, 100),
			input.textBody,
			input.createdAt,
		)
		.run();
}
