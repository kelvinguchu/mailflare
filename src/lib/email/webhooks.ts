import { and, desc, eq, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { webhookDeliveries, webhooks } from "@/db/schema";
import { newId } from "@/lib/ids";

export type WebhookEventType = "message.inbound" | "message.outbound" | "message.failed";
export type WebhookQueueMessage = { deliveryId: string };

export const MAX_WEBHOOK_DELIVERY_ATTEMPTS = 5;
export const WEBHOOK_DELIVERY_RETENTION_DAYS = 30;

export class WebhookRetryError extends Error {
	readonly delaySeconds: number;

	constructor(deliveryId: string, attempt: number) {
		super(`Retryable webhook delivery failure for ${deliveryId}`);
		this.name = "WebhookRetryError";
		this.delaySeconds = getWebhookRetryDelaySeconds(attempt);
	}
}

export async function dispatchWebhooks(
	env: CloudflareEnv,
	userId: string,
	eventType: WebhookEventType,
	payload: Record<string, unknown>,
): Promise<void> {
	const db = getDb(env);
	const hooks = await db.select().from(webhooks).where(eq(webhooks.userId, userId));

	for (const hook of hooks) {
		if (!hook.enabled || !includesEvent(hook.events, eventType)) continue;

		const deliveryId = newId("whd");
		const createdAt = new Date();
		const body = JSON.stringify({
			id: deliveryId,
			type: eventType,
			createdAt: createdAt.toISOString(),
			data: payload,
		});
		await db.insert(webhookDeliveries).values({
			id: deliveryId,
			webhookId: hook.id,
			eventType,
			payload: body,
			status: "pending",
			attempts: 0,
			createdAt,
		});

		try {
			await env.WEBHOOK_QUEUE.send({ deliveryId } satisfies WebhookQueueMessage);
		} catch {
			await db
				.update(webhookDeliveries)
				.set({ status: "failed", lastError: "E_WEBHOOK_ENQUEUE_FAILED" })
				.where(eq(webhookDeliveries.id, deliveryId));
			console.error(JSON.stringify({
				event: "webhook_enqueue_failed",
				deliveryId,
			}));
		}
	}
}

export async function processWebhookQueue(
	env: CloudflareEnv,
	payload: WebhookQueueMessage,
): Promise<void> {
	const db = getDb(env);
	const [delivery] = await db
		.select()
		.from(webhookDeliveries)
		.where(eq(webhookDeliveries.id, payload.deliveryId))
		.limit(1);
	if (!delivery || delivery.status === "delivered") return;

	const [hook] = await db
		.select()
		.from(webhooks)
		.where(eq(webhooks.id, delivery.webhookId))
		.limit(1);
	if (!hook || !hook.enabled) {
		await db
			.update(webhookDeliveries)
			.set({ status: "failed", nextAttemptAt: null, lastError: "E_WEBHOOK_DISABLED" })
			.where(eq(webhookDeliveries.id, delivery.id));
		return;
	}

	const attempt = delivery.attempts + 1;
	if (attempt > MAX_WEBHOOK_DELIVERY_ATTEMPTS) return;
	const body = normalizeStoredPayload(delivery);
	await db
		.update(webhookDeliveries)
		.set({
			payload: body,
			status: "delivering",
			attempts: attempt,
			lastAttemptAt: new Date(),
			nextAttemptAt: null,
			lastStatusCode: null,
			lastError: null,
		})
		.where(eq(webhookDeliveries.id, delivery.id));

	let response: Response;
	try {
		const signature = await signPayload(hook.secret, body);
		response = await fetch(hook.url, {
			method: "POST",
			redirect: "manual",
			signal: AbortSignal.timeout(10_000),
			headers: {
				"Content-Type": "application/json",
				"X-Email-Platform-Signature": signature,
				"X-Email-Platform-Event": delivery.eventType,
				"X-Email-Platform-Delivery": delivery.id,
				"X-Email-Platform-Timestamp": delivery.createdAt.toISOString(),
			},
			body,
		});
	} catch {
		await recordWebhookFailure(env, delivery.id, attempt, null, "E_WEBHOOK_NETWORK");
		return;
	}

	if (response.ok) {
		await db
			.update(webhookDeliveries)
			.set({
				status: "delivered",
				deliveredAt: new Date(),
				nextAttemptAt: null,
				lastStatusCode: response.status,
				lastError: null,
			})
			.where(eq(webhookDeliveries.id, delivery.id));
		return;
	}

	await recordWebhookFailure(
		env,
		delivery.id,
		attempt,
		response.status,
		`E_WEBHOOK_HTTP_${response.status}`,
		response.status === 429 || response.status >= 500,
	);
}

export async function redeliverWebhookForUser(
	env: CloudflareEnv,
	userId: string,
	webhookId: string,
	deliveryId: string,
): Promise<boolean> {
	const db = getDb(env);
	const [row] = await db
		.select({ id: webhookDeliveries.id })
		.from(webhookDeliveries)
		.innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
		.where(and(
			eq(webhookDeliveries.id, deliveryId),
			eq(webhooks.id, webhookId),
			eq(webhooks.userId, userId),
		))
		.limit(1);
	if (!row) return false;

	await db
		.update(webhookDeliveries)
		.set({
			status: "pending",
			attempts: 0,
			lastAttemptAt: null,
			nextAttemptAt: null,
			deliveredAt: null,
			lastStatusCode: null,
			lastError: null,
		})
		.where(eq(webhookDeliveries.id, deliveryId));
	try {
		await env.WEBHOOK_QUEUE.send({ deliveryId } satisfies WebhookQueueMessage);
		return true;
	} catch {
		await db
			.update(webhookDeliveries)
			.set({ status: "failed", lastError: "E_WEBHOOK_ENQUEUE_FAILED" })
			.where(eq(webhookDeliveries.id, deliveryId));
		throw new Error("Webhook redelivery could not be queued");
	}
}

export async function listWebhookDeliveriesForUser(
	env: CloudflareEnv,
	userId: string,
	webhookId: string,
) {
	return getDb(env)
		.select({
			id: webhookDeliveries.id,
			eventType: webhookDeliveries.eventType,
			status: webhookDeliveries.status,
			attempts: webhookDeliveries.attempts,
			lastAttemptAt: webhookDeliveries.lastAttemptAt,
			nextAttemptAt: webhookDeliveries.nextAttemptAt,
			deliveredAt: webhookDeliveries.deliveredAt,
			lastStatusCode: webhookDeliveries.lastStatusCode,
			lastError: webhookDeliveries.lastError,
			createdAt: webhookDeliveries.createdAt,
		})
		.from(webhookDeliveries)
		.innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
		.where(and(eq(webhooks.id, webhookId), eq(webhooks.userId, userId)))
		.orderBy(desc(webhookDeliveries.createdAt))
		.limit(100);
}

export async function deleteExpiredWebhookDeliveries(
	env: Pick<CloudflareEnv, "DB">,
	now = new Date(),
): Promise<void> {
	const cutoff = new Date(now.getTime() - WEBHOOK_DELIVERY_RETENTION_DAYS * 24 * 60 * 60 * 1_000);
	await getDb(env)
		.delete(webhookDeliveries)
		.where(lt(webhookDeliveries.createdAt, cutoff));
}

async function recordWebhookFailure(
	env: Pick<CloudflareEnv, "DB">,
	deliveryId: string,
	attempt: number,
	statusCode: number | null,
	errorCode: string,
	retryable = true,
): Promise<void> {
	const shouldRetry = retryable && attempt < MAX_WEBHOOK_DELIVERY_ATTEMPTS;
	const delaySeconds = getWebhookRetryDelaySeconds(attempt);
	await getDb(env)
		.update(webhookDeliveries)
		.set({
			status: "failed",
			nextAttemptAt: shouldRetry ? new Date(Date.now() + delaySeconds * 1_000) : null,
			lastStatusCode: statusCode,
			lastError: errorCode,
		})
		.where(eq(webhookDeliveries.id, deliveryId));
	if (shouldRetry) throw new WebhookRetryError(deliveryId, attempt);
}

function getWebhookRetryDelaySeconds(attempt: number): number {
	return Math.min(30 * (2 ** Math.max(0, attempt - 1)), 15 * 60);
}

function includesEvent(eventsJson: string, eventType: WebhookEventType): boolean {
	try {
		const events = JSON.parse(eventsJson) as unknown;
		return Array.isArray(events) && events.includes(eventType);
	} catch {
		return false;
	}
}

function normalizeStoredPayload(delivery: typeof webhookDeliveries.$inferSelect): string {
	try {
		const parsed = JSON.parse(delivery.payload) as unknown;
		if (
			typeof parsed === "object" && parsed !== null &&
			"id" in parsed && parsed.id === delivery.id &&
			"createdAt" in parsed && typeof parsed.createdAt === "string"
		) {
			return delivery.payload;
		}
		const data = typeof parsed === "object" && parsed !== null && "data" in parsed
			? parsed.data
			: parsed;
		return JSON.stringify({
			id: delivery.id,
			type: delivery.eventType,
			createdAt: delivery.createdAt.toISOString(),
			data,
		});
	} catch {
		return JSON.stringify({
			id: delivery.id,
			type: delivery.eventType,
			createdAt: delivery.createdAt.toISOString(),
			data: null,
		});
	}
}

async function signPayload(secret: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	return Array.from(new Uint8Array(signature))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
