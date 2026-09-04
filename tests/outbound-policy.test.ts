import { describe, expect, it } from "vitest";
import {
	classifyOutboundFailure,
	decideOutboundFailure,
	getOutboundRetryDelaySeconds,
	getOutboundErrorCode,
	MAX_OUTBOUND_DELIVERY_ATTEMPTS,
	shouldRetryOutboundFailure,
} from "../src/lib/email/outbound-policy";
import { isOutboundQueueMessage } from "../worker-utils";

describe("outbound delivery failure policy", () => {
	it.each([
		"E_RATE_LIMIT_EXCEEDED",
		"E_DELIVERY_FAILED",
		"E_INTERNAL_SERVER_ERROR",
	])("retries the transient Email Service error %s", (code) => {
		expect(classifyOutboundFailure({ code })).toBe("retryable");
	});

	it("treats Email Service validation errors as permanent", () => {
		expect(classifyOutboundFailure({ code: "E_INVALID_RECIPIENT" })).toBe("permanent");
	});

	it("uses HTTP-like status values when an error code is unavailable", () => {
		expect(classifyOutboundFailure({ status: 429 })).toBe("retryable");
		expect(classifyOutboundFailure({ statusCode: 503 })).toBe("retryable");
		expect(classifyOutboundFailure({ status: 400 })).toBe("permanent");
	});

	it("does not retry an unknown outcome after provider delivery starts", () => {
		expect(classifyOutboundFailure(new Error("connection closed"))).toBe("ambiguous");
		expect(decideOutboundFailure(new Error("connection closed"), 1, true)).toBe("unknown");
	});

	it("retries an infrastructure failure that happens before provider delivery", () => {
		expect(decideOutboundFailure(new Error("R2 temporarily unavailable"), 1, false)).toBe("retry");
	});

	it("marks permanent provider failures final without retrying", () => {
		expect(decideOutboundFailure({ code: "E_SENDER_NOT_VERIFIED" }, 1, true)).toBe("failed");
	});

	it("retries explicit transient provider rejection but stops at the attempt limit", () => {
		const error = { code: "E_RATE_LIMIT_EXCEEDED" };
		expect(decideOutboundFailure(error, 1, true)).toBe("retry");
		expect(decideOutboundFailure(error, MAX_OUTBOUND_DELIVERY_ATTEMPTS, true)).toBe("failed");
	});

	it("uses bounded exponential retry delays", () => {
		expect(getOutboundRetryDelaySeconds(1)).toBe(30);
		expect(getOutboundRetryDelaySeconds(2)).toBe(60);
		expect(getOutboundRetryDelaySeconds(10)).toBe(300);
	});

	it("bounds transient retries at the configured delivery-attempt limit", () => {
		const error = { code: "E_DELIVERY_FAILED" };
		expect(shouldRetryOutboundFailure(error, MAX_OUTBOUND_DELIVERY_ATTEMPTS - 1)).toBe(true);
		expect(shouldRetryOutboundFailure(error, MAX_OUTBOUND_DELIVERY_ATTEMPTS)).toBe(false);
	});

	it("normalizes provider error codes", () => {
		expect(getOutboundErrorCode({ code: " e_rate_limit_exceeded " })).toBe("E_RATE_LIMIT_EXCEEDED");
	});

	it("accepts only compact job references as outbound queue messages", () => {
		expect(isOutboundQueueMessage({ jobId: "job_123" })).toBe(true);
		expect(isOutboundQueueMessage({ jobId: "" })).toBe(false);
		expect(isOutboundQueueMessage({ to: "person@example.com" })).toBe(false);
	});
});
