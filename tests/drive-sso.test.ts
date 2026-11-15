import { describe, expect, it } from "vitest";
import { driveCallbackUrl, isValidDriveState, safeDriveNext } from "@/lib/drive/sso";

const state = "a".repeat(43);

describe("drive sign-in links", () => {
	it("accepts only a 32-byte base64url state", () => {
		expect(isValidDriveState(state)).toBe(true);
		expect(isValidDriveState("a".repeat(42))).toBe(false);
		expect(isValidDriveState(`${"a".repeat(42)}=`)).toBe(false);
		expect(isValidDriveState(null)).toBe(false);
	});

	it("only lets the login page return to /sso/drive with a valid state", () => {
		expect(safeDriveNext(`/sso/drive?state=${state}`)).toBe(`/sso/drive?state=${state}`);
		for (const next of [
			"/inbox",
			"https://evil.example/sso/drive?state=x",
			"//evil.example",
			`/sso/drive?state=${state}&next=//evil.example`,
			`/sso/drive?state=short`,
			`/sso/drive/../admin?state=${state}`,
			undefined,
			["/sso/drive"],
		]) {
			expect(safeDriveNext(next), String(next)).toBeNull();
		}
	});

	it("builds the drive callback from the configured origin only", () => {
		const url = new URL(driveCallbackUrl("https://drive.example.com/some/path", "c0de", state));
		expect(url.origin).toBe("https://drive.example.com");
		expect(url.pathname).toBe("/auth/callback");
		expect(url.searchParams.get("code")).toBe("c0de");
		expect(url.searchParams.get("state")).toBe(state);
	});
});
