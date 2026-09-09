export async function allowLoginAttempt(env: CloudflareEnv, request: Request): Promise<boolean> {
	if (!env.LOGIN_RATE_LIMIT) return true;
	const ip = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
	try {
		const outcome = await env.LOGIN_RATE_LIMIT.limit({ key: ip });
		return outcome.success;
	} catch (error) {
		console.warn("Login rate limiter unavailable", error);
		return true;
	}
}

export async function allowAccountRecoveryAttempt(
	env: CloudflareEnv,
	request: Request,
	accountKey: string,
	purpose: "request" | "confirm" | "verify" | "activate",
): Promise<boolean> {
	if (!env.PASSWORD_RESET_RATE_LIMIT) return env.DEPLOYMENT_ENV === "local";
	const ip = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
	try {
		const [ipHash, accountHash] = await Promise.all([
			hashRateLimitKey(ip),
			hashRateLimitKey(accountKey.trim().toLowerCase()),
		]);
		const outcomes = await Promise.all([
			env.PASSWORD_RESET_RATE_LIMIT.limit({ key: `${purpose}:ip:${ipHash}` }),
			env.PASSWORD_RESET_RATE_LIMIT.limit({ key: `${purpose}:account:${accountHash}` }),
		]);
		return outcomes.every((outcome) => outcome.success);
	} catch (error) {
		console.warn("Account recovery rate limiter unavailable", error);
		return false;
	}
}

async function hashRateLimitKey(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
