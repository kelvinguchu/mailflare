import { and, desc, eq, gte, isNull, lte, ne } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { messages } from "@/db/schema";
import { getEmailAddress } from "@/lib/email/address";
import { newId } from "@/lib/ids";

const MAX_REFERENCES = 20;
const SUBJECT_FALLBACK_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const SUBJECT_PREFIX = /^(?:(?:re|fwd?|aw|sv)\s*:\s*)+/i;
const MESSAGE_ID_TOKEN = /<?[^\s<>]+@[^\s<>]+>?/g;
const EMAIL_TOKEN = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+/gi;

export type ThreadAssignmentInput = {
	mailboxId: string;
	inReplyTo?: string | null;
	references?: string[] | null;
	subject?: string | null;
	fromAddr: string;
	createdAt: Date;
};

export type MessageThreading = {
	threadId: string;
	providerMessageId: string;
	inReplyTo: string | null;
	references: string;
	replyToMessageId: string | null;
	headers: Record<string, string>;
};

type ThreadCandidate = Pick<
	typeof messages.$inferSelect,
	"id" | "threadId" | "providerMessageId" | "references"
>;

export function normalizeProviderMessageId(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	const bare = trimmed.replace(/^<+|>+$/g, "");
	if (!bare.includes("@") || /\s/.test(bare)) return null;
	return `<${bare}>`;
}

export function parseMessageReferences(value: string | null | undefined): string[] {
	if (!value?.trim()) return [];
	const matches = value.match(MESSAGE_ID_TOKEN) ?? value.split(/\s+/);
	return capReferences(
		matches.map(normalizeProviderMessageId).filter((item): item is string => item !== null),
	);
}

export function parseStoredReferences(value: string | null | undefined): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value) as string[];
		if (!Array.isArray(parsed)) return [];
		return capReferences(
			parsed
				.filter((item): item is string => typeof item === "string")
				.map(normalizeProviderMessageId)
				.filter((item): item is string => item !== null),
		);
	} catch {
		return [];
	}
}

export function normalizeThreadSubject(value: string | null | undefined): string {
	return (value ?? "").trim().replace(SUBJECT_PREFIX, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export async function resolveThreadAssignment(
	db: AppDatabase,
	input: ThreadAssignmentInput,
): Promise<{ threadId: string; replyToMessageId: string | null }> {
	const inReplyTo = normalizeProviderMessageId(input.inReplyTo);
	if (inReplyTo) {
		const parent = await findByProviderMessageId(db, input.mailboxId, inReplyTo);
		if (parent) return assignmentFromParent(db, parent);
	}

	for (const reference of capReferences(input.references ?? []).toReversed()) {
		const parent = await findByProviderMessageId(db, input.mailboxId, reference);
		if (parent) return assignmentFromParent(db, parent);
	}

	const normalizedSubject = normalizeThreadSubject(input.subject);
	if (normalizedSubject) {
		const candidates = await db
			.select({
				id: messages.id,
				threadId: messages.threadId,
				providerMessageId: messages.providerMessageId,
				references: messages.references,
				fromAddr: messages.fromAddr,
				toAddr: messages.toAddr,
				subject: messages.subject,
			})
			.from(messages)
			.where(
				and(
					eq(messages.mailboxId, input.mailboxId),
					ne(messages.status, "draft"),
					gte(messages.createdAt, new Date(input.createdAt.getTime() - SUBJECT_FALLBACK_WINDOW_MS)),
					lte(messages.createdAt, input.createdAt),
				),
			)
			.orderBy(desc(messages.createdAt), desc(messages.id));
		const sender = extractAddresses(input.fromAddr)[0];
		const parent = candidates.find(
			(candidate) =>
				normalizeThreadSubject(candidate.subject) === normalizedSubject &&
				!!sender &&
				new Set([
					...extractAddresses(candidate.fromAddr),
					...extractAddresses(candidate.toAddr),
				]).has(sender),
		);
		if (parent) return assignmentFromParent(db, parent);
	}

	return { threadId: newId("thr"), replyToMessageId: null };
}

export async function buildOutboundThreading(
	db: AppDatabase,
	input: {
		messageId: string;
		mailboxId: string;
		fromAddr: string;
		replyToMessageId?: string | null;
	},
): Promise<MessageThreading> {
	const providerMessageId = createOutboundProviderMessageId(input.messageId, input.fromAddr);
	if (!input.replyToMessageId) {
		return {
			threadId: newId("thr"),
			providerMessageId,
			inReplyTo: null,
			references: "[]",
			replyToMessageId: null,
			headers: {},
		};
	}

	const [parent] = await db
		.select({
			id: messages.id,
			mailboxId: messages.mailboxId,
			threadId: messages.threadId,
			providerMessageId: messages.providerMessageId,
			references: messages.references,
			status: messages.status,
		})
		.from(messages)
		.where(eq(messages.id, input.replyToMessageId))
		.limit(1);
	if (!parent || parent.mailboxId !== input.mailboxId || parent.status === "draft") {
		throw new Error("Reply message is not readable in the selected mailbox");
	}

	const threadId = await ensureThreadId(db, parent);
	const inReplyTo = normalizeProviderMessageId(parent.providerMessageId);
	const references = capReferences([
		...parseStoredReferences(parent.references),
		...(inReplyTo ? [inReplyTo] : []),
	]);
	const headers: Record<string, string> = {};
	if (inReplyTo) headers["In-Reply-To"] = inReplyTo;
	if (references.length > 0) headers.References = references.join(" ");

	return {
		threadId,
		providerMessageId,
		inReplyTo,
		references: JSON.stringify(references),
		replyToMessageId: parent.id,
		headers,
	};
}

export function createOutboundProviderMessageId(messageId: string, fromAddr: string): string {
	const address = getEmailAddress(fromAddr);
	const at = address.lastIndexOf("@");
	const domain =
		at >= 0
			? address
					.slice(at + 1)
					.trim()
					.toLowerCase()
			: "";
	return `<${messageId}@${domain || "mailflare.local"}>`;
}

function capReferences(references: string[]): string[] {
	return Array.from(new Set(references.map(normalizeProviderMessageId).filter(isString))).slice(
		-MAX_REFERENCES,
	);
}

function isString(value: string | null): value is string {
	return value !== null;
}

function extractAddresses(value: string): string[] {
	return Array.from(
		new Set((value.match(EMAIL_TOKEN) ?? []).map((address) => address.toLowerCase())),
	);
}

async function findByProviderMessageId(
	db: AppDatabase,
	mailboxId: string,
	providerMessageId: string,
): Promise<ThreadCandidate | null> {
	const [candidate] = await db
		.select({
			id: messages.id,
			threadId: messages.threadId,
			providerMessageId: messages.providerMessageId,
			references: messages.references,
		})
		.from(messages)
		.where(
			and(
				eq(messages.mailboxId, mailboxId),
				eq(messages.providerMessageId, providerMessageId),
				ne(messages.status, "draft"),
			),
		)
		.orderBy(desc(messages.createdAt), desc(messages.id))
		.limit(1);
	return candidate ?? null;
}

async function assignmentFromParent(
	db: AppDatabase,
	parent: ThreadCandidate,
): Promise<{ threadId: string; replyToMessageId: string }> {
	return { threadId: await ensureThreadId(db, parent), replyToMessageId: parent.id };
}

async function ensureThreadId(db: AppDatabase, message: ThreadCandidate): Promise<string> {
	if (message.threadId) return message.threadId;
	const proposed = newId("thr");
	await db
		.update(messages)
		.set({ threadId: proposed })
		.where(and(eq(messages.id, message.id), isNull(messages.threadId)));
	const [current] = await db
		.select({ threadId: messages.threadId })
		.from(messages)
		.where(eq(messages.id, message.id))
		.limit(1);
	return current?.threadId ?? proposed;
}
