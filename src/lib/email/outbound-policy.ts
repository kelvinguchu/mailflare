export const MAX_OUTBOUND_DELIVERY_ATTEMPTS = 4;

const RETRYABLE_EMAIL_ERROR_CODES = new Set([
	"E_DELIVERY_FAILED",
	"E_INTERNAL_SERVER_ERROR",
	"E_RATE_LIMIT_EXCEEDED",
]);

export type OutboundFailureDisposition = "retryable" | "permanent";

export function getOutboundErrorCode(error: unknown): string | null {
	if (typeof error !== "object" || error === null || !("code" in error)) return null;
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" && code.trim() ? code.trim().toUpperCase() : null;
}

export function classifyOutboundFailure(error: unknown): OutboundFailureDisposition {
	const code = getOutboundErrorCode(error);
	if (code && RETRYABLE_EMAIL_ERROR_CODES.has(code)) return "retryable";
	if (code?.startsWith("E_")) return "permanent";

	if (typeof error === "object" && error !== null) {
		const candidate = error as { status?: unknown; statusCode?: unknown };
		const status = typeof candidate.status === "number"
			? candidate.status
			: typeof candidate.statusCode === "number"
				? candidate.statusCode
				: null;
		if (status === 429 || (status !== null && status >= 500)) return "retryable";
		if (status !== null && status >= 400) return "permanent";
	}

	// Unknown infrastructure failures are retried within the bounded queue policy.
	return "retryable";
}

export function shouldRetryOutboundFailure(
	error: unknown,
	attempt: number,
	maxAttempts = MAX_OUTBOUND_DELIVERY_ATTEMPTS,
): boolean {
	return classifyOutboundFailure(error) === "retryable" && attempt < maxAttempts;
}
