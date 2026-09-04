import { describe, expect, it } from "vitest";
import {
	classifyOutboundFailure,
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
