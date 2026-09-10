export function getSendErrorStatus(message: string): number {
	if (message === "Mailbox is required") return 400;
	if (message.includes("send rate limit") || message.includes("daily send limit")) return 429;
	if (message === "Recipient is suppressed") return 422;
	if (message.startsWith("Idempotency-Key must contain")) return 400;
	if (
		message === "Mailbox not found" ||
		message === "Sender account not found" ||
		message === "Sender mailbox is disabled" ||
		message === "Sender domain is not ready for sending" ||
		message === "You do not have permission to send from this mailbox" ||
		message === "Sender address does not match the selected mailbox"
	) {
		return 403;
	}
	return 500;
}
