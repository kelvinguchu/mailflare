export function scoreSpamHeaders(headers: Record<string, string> | undefined): { score: number; reasons: string[] } {
	if (!headers) return { score: 0, reasons: [] };
	const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
	let score = 0;
	const reasons: string[] = [];
	if ((normalized["x-spam-status"] ?? "").toLowerCase().startsWith("yes")) {
		score += 8;
		reasons.push("Upstream filter marked the message as spam");
	}
	const upstreamScore = Number.parseFloat(normalized["x-spam-score"] ?? "");
	if (Number.isFinite(upstreamScore) && upstreamScore > 0) score += Math.min(10, Math.ceil(upstreamScore));
	const authentication = normalized["authentication-results"]?.toLowerCase() ?? "";
	for (const mechanism of ["spf", "dkim", "dmarc"]) {
		if (new RegExp(`(?:^|[;\\s])${mechanism}=fail(?:[;\\s]|$)`).test(authentication)) {
			score += 3;
			reasons.push(`${mechanism.toUpperCase()} failed`);
		}
	}
	return { score, reasons };
}
