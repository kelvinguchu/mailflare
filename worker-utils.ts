import type { InboundQueueMessage } from "./src/lib/email/inbound";
import type { OutboundQueueMessage } from "./src/lib/email/send";
import type { WebhookQueueMessage } from "./src/lib/email/webhooks";

export function isInboundQueueMessage(payload: unknown): payload is InboundQueueMessage {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"rawR2Key" in payload &&
		"from" in payload &&
		"to" in payload
	);
}

export function isOutboundQueueMessage(payload: unknown): payload is OutboundQueueMessage {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"jobId" in payload &&
		typeof payload.jobId === "string" &&
		payload.jobId.length > 0
	);
}

export function isWebhookQueueMessage(payload: unknown): payload is WebhookQueueMessage {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"deliveryId" in payload &&
		typeof payload.deliveryId === "string" &&
		payload.deliveryId.length > 0
	);
}
