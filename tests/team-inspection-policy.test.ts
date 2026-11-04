import { describe, it, expect } from "vitest";
import { canInspectTeam } from "../src/lib/team-inboxes/policy";
const user = {
	email: "mohamed@calibercode.io",
	disabled: false,
	activationStatus: "active" as const,
};
describe("exclusive inspection policy", () => {
	it("allows only the configured identity in its deployment environment", () => {
		expect(canInspectTeam({ DEPLOYMENT_ENV: "production" }, user)).toBe(true);
		expect(
			canInspectTeam({ DEPLOYMENT_ENV: "local" }, { ...user, email: "admin@example.com" }),
		).toBe(true);
		for (const DEPLOYMENT_ENV of [undefined, "staging", "local"] as const)
			expect(canInspectTeam({ DEPLOYMENT_ENV }, user)).toBe(false);
		expect(
			canInspectTeam({ DEPLOYMENT_ENV: "production" }, { ...user, email: "admin@example.com" }),
		).toBe(false);
		expect(
			canInspectTeam(
				{ DEPLOYMENT_ENV: "production" },
				{ ...user, email: "other-admin@calibercode.io" },
			),
		).toBe(false);
		expect(canInspectTeam({ DEPLOYMENT_ENV: "production" }, { ...user, disabled: true })).toBe(
			false,
		);
		expect(
			canInspectTeam({ DEPLOYMENT_ENV: "production" }, { ...user, activationStatus: "pending" }),
		).toBe(false);
	});
});
