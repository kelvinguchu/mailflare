import { describe, expect, it } from "vitest";
import {
	decideOutboundDeadLetterReplay,
	getDeadLetterSource,
	INBOUND_DEAD_LETTER_QUEUE,
	OUTBOUND_DEAD_LETTER_QUEUE,
	toSafeDiagnosticCode,
} from "../src/lib/queues/dead-letter-policy";

describe("dead-letter handling", () => {
	it("recognizes only the configured dead-letter queues", () => {
		expect(getDeadLetterSource(INBOUND_DEAD_LETTER_QUEUE)).toBe("inbound");
		expect(getDeadLetterSource(OUTBOUND_DEAD_LETTER_QUEUE)).toBe("outbound");
		expect(getDeadLetterSource("mailflare-inbound")).toBeNull();
	});

	it("exposes safe error codes but not arbitrary provider text", () => {
		expect(toSafeDiagnosticCode("e_sender_not_verified")).toBe("E_SENDER_NOT_VERIFIED");
		expect(toSafeDiagnosticCode("Failed for person@example.com: private subject")).toBe(
			"QUEUE_RETRIES_EXHAUSTED",
		);
	});

	it("requeues work that never reached the provider", () => {
		expect(decideOutboundDeadLetterReplay({
			status: "queued",
			deliveryStartedAt: null,
			error: "E_STORED_ATTACHMENT_MISSING",
			messageId: "msg_1",
		})).toBe("enqueue");
	});

	it("permits a failed provider rejection to be retried after an operator fix", () => {
		expect(decideOutboundDeadLetterReplay({
			status: "failed",
			deliveryStartedAt: new Date(),
			error: "E_SENDER_NOT_VERIFIED",
			messageId: "msg_1",
		})).toBe("reset_and_enqueue");
	});

	it("never replays an ambiguous provider outcome", () => {
		expect(decideOutboundDeadLetterReplay({
			status: "failed",
			deliveryStartedAt: new Date(),
			error: "E_DELIVERY_OUTCOME_UNKNOWN",
			messageId: "msg_1",
		})).toBe("blocked_unknown_outcome");
		expect(decideOutboundDeadLetterReplay({
			status: "sending",
			deliveryStartedAt: new Date(),
			error: null,
			messageId: "msg_1",
		})).toBe("blocked_in_flight");
	});

	it("treats an already-sent job as an idempotent no-op", () => {
		expect(decideOutboundDeadLetterReplay({
			status: "sent",
			deliveryStartedAt: new Date(),
			error: null,
			messageId: "msg_1",
		})).toBe("already_sent");
	});
});
