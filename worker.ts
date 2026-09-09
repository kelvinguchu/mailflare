import { default as nextHandler } from "./.open-next/worker.js";
import {
	createInboundDeliveryKey,
	processInboundMessage,
	storeRawToR2,
	type InboundQueueMessage,
} from "./src/lib/email/inbound";
import { OutboundRetryError, processOutboundQueue } from "./src/lib/email/send";
import { getDb } from "./src/db";
import { resolveInboundAddress } from "./src/lib/email/routing";
import {
	isInboundQueueMessage,
	isOutboundQueueMessage,
	isWebhookQueueMessage,
} from "./worker-utils";
import { getUserFromSession } from "./src/lib/auth/session";
import { getSessionTokenFromRequest } from "./src/lib/realtime/utils";
import {
	getAccountForwardingDestination,
	MAILFLARE_FORWARDED_HEADER,
} from "./src/lib/email/account-forwarding";
import { runScheduledBackup } from "./src/lib/backups/scheduler";
import {
	captureDeadLetterMessage,
	captureFinalOutboundFailure,
} from "./src/lib/queues/dead-letters";
import { getDeadLetterSource } from "./src/lib/queues/dead-letter-policy";
import {
	deleteExpiredWebhookDeliveries,
	processWebhookQueue,
	WebhookRetryError,
} from "./src/lib/email/webhooks";
import { deleteExpiredAccountRecoveryTokens } from "./src/lib/auth/recovery";
import { deleteExpiredSessions } from "./src/lib/auth/session";
export { RealtimeHub } from "./src/lib/realtime/hub";
export { DatabaseBackupWorkflow } from "./src/lib/backups/workflow";

export default {
	async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
		const url = new URL(request.url);
		if (url.pathname === "/api/realtime") {
			if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
				return new Response("Expected WebSocket upgrade", { status: 426 });
			}

			const user = await getUserFromSession(env, getSessionTokenFromRequest(request));
			if (!user || user.disabled || user.activationStatus !== "active") {
				return new Response("Unauthorized", { status: 401 });
			}

			const hub = env.REALTIME.getByName(user.id);
			return hub.fetch(new Request("https://cc-mail-realtime/connect", request));
		}

		return nextHandler.fetch(request, env, ctx);
	},

	async email(message: ForwardableEmailMessage, env: CloudflareEnv, ctx: ExecutionContext) {
		try {
			const decision = await resolveInboundAddress(getDb(env), message.to);
			if (!decision?.mailbox || decision.action !== "store") {
				message.setReject("Unknown recipient");
				return;
			}
			if (message.headers.get(MAILFLARE_FORWARDED_HEADER) !== "1") {
				const forwardingDestination = await getAccountForwardingDestination(env, message.to);
				if (forwardingDestination) {
					try {
						const forwardingHeaders = new Headers();
						forwardingHeaders.set(MAILFLARE_FORWARDED_HEADER, "1");
						await message.forward(forwardingDestination, forwardingHeaders);
					} catch (error) {
						console.error(`Account forwarding failed for ${message.to}`, error);
					}
				}
			}
			const raw = await new Response(message.raw).arrayBuffer();
			const deliveryKey = await createInboundDeliveryKey(message.from, message.to, raw);
			const rawR2Key = await storeRawToR2(env, message.from, message.to, raw, deliveryKey);
			const payload: InboundQueueMessage = {
				from: message.from,
				to: message.to,
				rawR2Key,
				deliveryKey,
				headers: Object.fromEntries(message.headers),
			};
			await env.INBOUND_QUEUE.send(payload);
		} catch (err) {
			console.error("Inbound enqueue failed", err);
			message.setReject("Processing failed");
		}
	},

	async scheduled(controller: ScheduledController, env: CloudflareEnv) {
		await runScheduledBackup(env, new Date(controller.scheduledTime));
		try {
			await deleteExpiredWebhookDeliveries(env, new Date(controller.scheduledTime));
		} catch (error) {
			console.error(JSON.stringify({
				event: "webhook_retention_cleanup_failed",
				error: error instanceof Error ? error.message : "Unknown cleanup error",
			}));
		}
		try {
			await deleteExpiredAccountRecoveryTokens(env, new Date(controller.scheduledTime));
		} catch (error) {
			console.error(JSON.stringify({
				event: "account_recovery_token_cleanup_failed",
				error: error instanceof Error ? error.message : "Unknown cleanup error",
			}));
		}
		try {
			await deleteExpiredSessions(env, new Date(controller.scheduledTime));
		} catch (error) {
			console.error(JSON.stringify({
				event: "expired_session_cleanup_failed",
				error: error instanceof Error ? error.message : "Unknown cleanup error",
			}));
		}
	},

	async queue(batch: MessageBatch, env: CloudflareEnv): Promise<void> {
		const deadLetterSource = getDeadLetterSource(batch.queue);
		for (const msg of batch.messages) {
			try {
				if (deadLetterSource) {
					await captureDeadLetterMessage(env, batch.queue, msg);
				} else if (isInboundQueueMessage(msg.body)) {
					await processInboundMessage(env, msg.body);
				} else if (isOutboundQueueMessage(msg.body)) {
					await processOutboundQueue(env, msg.body, { attempt: msg.attempts });
					await captureFinalOutboundFailure(env, batch.queue, {
						id: msg.id,
						timestamp: msg.timestamp,
						attempts: msg.attempts,
						body: msg.body,
					});
				} else if (isWebhookQueueMessage(msg.body)) {
					await processWebhookQueue(env, msg.body);
				} else {
					console.error(JSON.stringify({
						event: "queue_message_malformed",
						queue: batch.queue,
						messageId: msg.id,
					}));
				}
				msg.ack();
			} catch (err) {
				console.error(JSON.stringify({
					event: deadLetterSource ? "dead_letter_persistence_failed" : "queue_processing_failed",
					queue: batch.queue,
					messageId: msg.id,
					attempt: msg.attempts,
					errorCode: getQueueErrorCode(err),
				}));
				msg.retry({
					delaySeconds: deadLetterSource
						? 3600
						: err instanceof OutboundRetryError
							? err.delaySeconds
							: err instanceof WebhookRetryError
								? err.delaySeconds
							: 10,
				});
			}
		}
	},
} satisfies ExportedHandler<CloudflareEnv>;

function getQueueErrorCode(error: unknown): string {
	if (typeof error === "object" && error !== null && "code" in error) {
		const code = (error as { code?: unknown }).code;
		if (typeof code === "string" && /^E_[A-Z0-9_]{1,96}$/.test(code.toUpperCase())) {
			return code.toUpperCase();
		}
	}
	if (error instanceof OutboundRetryError) return "OUTBOUND_RETRY";
	if (error instanceof WebhookRetryError) return "WEBHOOK_RETRY";
	return "QUEUE_HANDLER_ERROR";
}
