import { describe, expect, it, vi } from "vitest";
import { allowAccountRecoveryAttempt } from "../src/lib/auth/rate-limit";

describe("account recovery rate limiting", () => {
	it("checks independent hashed IP and account keys", async () => {
		const limit = vi.fn(async () => ({ success: true }));
		const env = {
			DEPLOYMENT_ENV: "production",
			PASSWORD_RESET_RATE_LIMIT: { limit },
		} as unknown as CloudflareEnv;
		const request = new Request("https://mail.example.test", {
			headers: { "cf-connecting-ip": "203.0.113.8" },
		});
		expect(await allowAccountRecoveryAttempt(env, request, "User@Example.test", "request")).toBe(true);
		expect(limit).toHaveBeenCalledTimes(2);
		const keys = limit.mock.calls.map(([input]) => input.key as string);
		expect(keys).toEqual(expect.arrayContaining([
			expect.stringMatching(/^request:ip:[a-f0-9]{64}$/),
			expect.stringMatching(/^request:account:[a-f0-9]{64}$/),
		]));
		expect(keys.join(" ")).not.toContain("203.0.113.8");
		expect(keys.join(" ")).not.toContain("user@example.test");
	});

	it("fails closed when either counter rejects or the binding errors", async () => {
		const request = new Request("https://mail.example.test");
		const rejected = {
			DEPLOYMENT_ENV: "production",
			PASSWORD_RESET_RATE_LIMIT: {
				limit: vi.fn()
					.mockResolvedValueOnce({ success: true })
					.mockResolvedValueOnce({ success: false }),
			},
		} as unknown as CloudflareEnv;
		expect(await allowAccountRecoveryAttempt(rejected, request, "user@example.test", "confirm")).toBe(false);

		const unavailable = {
			DEPLOYMENT_ENV: "production",
			PASSWORD_RESET_RATE_LIMIT: { limit: vi.fn(async () => { throw new Error("offline"); }) },
		} as unknown as CloudflareEnv;
		expect(await allowAccountRecoveryAttempt(unavailable, request, "user@example.test", "confirm")).toBe(false);
	});
});
