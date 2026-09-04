import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { buildSnippet, parseRawMime } from "@/lib/email/parse";
import { resolveInboundAddress, resolveInboxRuleDestination } from "@/lib/email/routing";
import { dispatchWebhooks } from "@/lib/email/webhooks";
import { getMessageContactNames, upsertContactFromAddress } from "@/lib/contacts/service";
import { formatEmailAddress, getEmailAddress } from "@/lib/email/address";
import { sendMailboxAutoReply } from "@/lib/email/auto-reply";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import { listMessageAttachments } from "@/lib/email/attachments";
import { stageInboundMessageAttachments } from "@/lib/email/inbound-attachments";
import { getUnsubscribeUrlFromRawR2Key } from "@/lib/email/unsubscribe";
import type { SessionUser } from "@/lib/auth/types";
import {
	getMailboxNotificationUserIds,
	notifyUsersOfNewMessage,
} from "@/lib/realtime/utils";
import {
	commitInboundMessage,
	createInboundDeliveryKey,
	createInboundMessageId,
	findInboundMessageId,
	isInboundDeliveryKey,
} from "@/lib/email/inbound-idempotency";

export { createInboundDeliveryKey } from "@/lib/email/inbound-idempotency";

export type InboundQueueMessage = {
	from: string;
	to: string;
	rawR2Key: string;
	deliveryKey?: string;
	headers?: Record<string, string>;
};

export async function processInboundMessage(
	env: CloudflareEnv,
	payload: InboundQueueMessage,
): Promise<void> {
	const db = getDb(env);
	const decision = await resolveInboundAddress(db, payload.to);

	if (!decision) {
		console.warn(`No routing for inbound address: ${payload.to}`);
		return;
	}

	if (decision.action === "reject") {
		console.warn(`Rejected inbound: ${payload.to}`);
		return;
	}

	if (decision.action === "forward" && decision.forwardTo) {
		console.info(`Forward ${payload.to} -> ${decision.forwardTo}`);
		return;
	}

	if (!decision.mailbox) return;

	const raw = await env.BUCKET.get(payload.rawR2Key);
	if (!raw) {
		throw new Error(`Missing inbound R2 object: ${payload.rawR2Key}`);
	}

	const buffer = await raw.arrayBuffer();
	const parsed = await parseRawMime(buffer);
	const deliveryKey = isInboundDeliveryKey(payload.deliveryKey)
		? payload.deliveryKey
		: await createInboundDeliveryKey(payload.from, payload.to, buffer);
	const existingMessageId = await findInboundMessageId(env.DB, deliveryKey);
	if (existingMessageId) {
		logDuplicateDelivery(deliveryKey, existingMessageId);
		return;
	}
	const messageId = createInboundMessageId(deliveryKey);
	const snippet = buildSnippet(parsed.text, parsed.html);
	const deliveredAddress = getEmailAddress(payload.to) || `${decision.mailbox.localPart}@${decision.mailbox.hostname}`;
	const toAddr = formatEmailAddress(deliveredAddress, decision.mailbox.displayName ?? decision.mailbox.localPart);
	const fromAddr = parsed.fromAddr ?? payload.from;
	const destination = await resolveInboxRuleDestination(db, {
		mailboxId: decision.mailbox.mailboxId,
		toAddress: toAddr,
		fromAddress: fromAddr,
		subject: parsed.subject,
		content: [parsed.text, parsed.html, snippet].filter(Boolean).join(" "),
	});
	const contact = await upsertContactFromAddress(env, {
		userId: decision.mailbox.userId,
		address: fromAddr,
		source: "inbound",
	});

	const attachments = await stageInboundMessageAttachments(
		env,
		messageId,
		deliveryKey,
		parsed.attachments,
	);
	const committed = await commitInboundMessage(env.DB, {
		id: messageId,
		deliveryKey,
		userId: decision.mailbox.userId,
		mailboxId: decision.mailbox.mailboxId,
		folderId: destination.folderId,
		providerMessageId: parsed.messageId,
		fromAddr,
		toAddr,
		subject: parsed.subject,
		snippet,
		textBody: parsed.text,
		htmlBody: parsed.html,
		rawR2Key: payload.rawR2Key,
		status: destination.status,
		threadId: parsed.messageId,
		createdAt: new Date(),
	}, attachments);
	if (!committed.created) {
		logDuplicateDelivery(deliveryKey, committed.messageId);
		return;
	}

	if (destination.status === "received") {
		try {
			await sendMailboxAutoReply(env, {
				mailboxId: decision.mailbox.mailboxId,
				userId: decision.mailbox.userId,
				deliveredAddress,
				fromAddress: fromAddr,
				incomingMessageId: parsed.messageId,
				headers: payload.headers,
			});
		} catch (error) {
			console.error(`Auto-reply failed for mailbox ${decision.mailbox.mailboxId}`, error);
		}
	}

	try {
		const notificationUserIds = await getMailboxNotificationUserIds(
			env,
			decision.mailbox.mailboxId,
			decision.mailbox.userId,
		);
		await notifyUsersOfNewMessage(env, notificationUserIds, {
			type: "new_message",
			messageId,
			mailboxId: decision.mailbox.mailboxId,
			from: fromAddr,
			fromName: contact?.displayName ?? null,
			subject: parsed.subject,
		});
	} catch (error) {
		console.error(JSON.stringify({
			event: "inbound_notification_failed",
			messageId,
			error: error instanceof Error ? error.message : "Unknown notification error",
		}));
	}
	try {
		await dispatchWebhooks(env, decision.mailbox.userId, "message.inbound", {
			messageId,
			from: fromAddr,
			to: toAddr,
			subject: parsed.subject,
		});
	} catch (error) {
		console.error(JSON.stringify({
			event: "inbound_webhook_dispatch_failed",
			messageId,
			error: error instanceof Error ? error.message : "Unknown webhook error",
		}));
	}
}

export async function storeRawToR2(
	env: CloudflareEnv,
	from: string,
	to: string,
	raw: ArrayBuffer,
	deliveryKey: string,
): Promise<string> {
	const key = `inbound/${deliveryKey}.eml`;
	const existing = await env.BUCKET.head(key);
	if (existing?.size === raw.byteLength && existing.customMetadata?.deliveryKey === deliveryKey) {
		return key;
	}
	const object = await env.BUCKET.put(key, raw, {
		httpMetadata: { contentType: "message/rfc822" },
		customMetadata: { from, to, deliveryKey },
	});
	if (!object || object.size !== raw.byteLength) throw new Error("Failed to store inbound email source");
	return key;
}

function logDuplicateDelivery(deliveryKey: string, messageId: string): void {
	console.info(JSON.stringify({
		event: "inbound_duplicate_suppressed",
		deliveryKeyPrefix: deliveryKey.slice(0, 12),
		messageId,
	}));
}

export async function getMessageWithBody(env: CloudflareEnv, userId: string, messageId: string) {
	const db = getDb(env);
	const [message] = await db
		.select()
		.from(messages)
		.where(eq(messages.id, messageId))
		.limit(1);
	if (!message || message.userId !== userId) return null;
	const contactNames = await getMessageContactNames(env, userId, message.fromAddr, message.toAddr);
	const attachments = await listMessageAttachments(env, messageId);
	const unsubscribeUrl = await getUnsubscribeUrlFromRawR2Key(env, message.rawR2Key);
	return { message: { ...message, ...contactNames }, body: message, attachments, unsubscribeUrl };
}

export async function getMessageWithBodyForUser(env: CloudflareEnv, user: SessionUser, messageId: string) {
	const db = getDb(env);
	const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
	if (!message?.mailboxId) return null;
	const access = await getMailboxAccessLevel(db, user, message.mailboxId);
	if (!access?.canRead) return null;
	const contactNames = await getMessageContactNames(env, message.userId, message.fromAddr, message.toAddr);
	const attachments = await listMessageAttachments(env, messageId);
	const unsubscribeUrl = await getUnsubscribeUrlFromRawR2Key(env, message.rawR2Key);
	return { message: { ...message, ...contactNames }, body: message, attachments, unsubscribeUrl };
}

export async function getMessageMetadataForUser(env: CloudflareEnv, user: SessionUser, messageId: string) {
	const db = getDb(env);
	const [message] = await db
		.select({ mailboxId: messages.mailboxId, rawR2Key: messages.rawR2Key })
		.from(messages)
		.where(eq(messages.id, messageId))
		.limit(1);
	if (!message?.mailboxId) return null;
	const access = await getMailboxAccessLevel(db, user, message.mailboxId);
	if (!access?.canRead) return null;
	const [attachments, unsubscribeUrl] = await Promise.all([
		listMessageAttachments(env, messageId),
		getUnsubscribeUrlFromRawR2Key(env, message.rawR2Key),
	]);
	return { attachments, unsubscribeUrl };
}
