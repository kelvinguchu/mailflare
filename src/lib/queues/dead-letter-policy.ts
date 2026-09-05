export const INBOUND_DEAD_LETTER_QUEUE = "mailflare-inbound-dlq";
export const OUTBOUND_DEAD_LETTER_QUEUE = "mailflare-outbound-dlq";
export const PRIMARY_QUEUE_RETRY_LIMIT = 3;

export type DeadLetterSource = "inbound" | "outbound";
export type DeadLetterStatus = "unresolved" | "replaying" | "replayed";

export type OutboundReplayDecision =
	| "already_sent"
	| "enqueue"
	| "reset_and_enqueue"
	| "blocked_unknown_outcome"
	| "blocked_in_flight"
	| "blocked_invalid_state";

export function getDeadLetterSource(queueName: string): DeadLetterSource | null {
	if (queueName === INBOUND_DEAD_LETTER_QUEUE) return "inbound";
	if (queueName === OUTBOUND_DEAD_LETTER_QUEUE) return "outbound";
	return null;
}

export function toSafeDiagnosticCode(value: string | null | undefined): string {
	const normalized = value?.trim().toUpperCase();
	return normalized && /^E_[A-Z0-9_]{1,96}$/.test(normalized)
		? normalized
		: "QUEUE_RETRIES_EXHAUSTED";
}

export function decideOutboundDeadLetterReplay(job: {
	status: string;
	deliveryStartedAt: Date | null;
	error: string | null;
	messageId: string | null;
}): OutboundReplayDecision {
	if (job.status === "sent") return "already_sent";
	if (job.status === "sending") return "blocked_in_flight";
	if (job.error === "E_DELIVERY_OUTCOME_UNKNOWN") return "blocked_unknown_outcome";
	if (job.status === "queued") {
		return job.deliveryStartedAt === null ? "enqueue" : "blocked_unknown_outcome";
	}
	if (job.status === "failed") {
		return job.messageId ? "reset_and_enqueue" : "blocked_invalid_state";
	}
	return "blocked_invalid_state";
}
