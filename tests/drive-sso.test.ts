import { describe, expect, it } from "vitest";
import {
	allowedDriveOrigins,
	driveCallbackUrl,
	driveSsoPath,
	isValidDriveState,
	pickDriveOrigin,
	safeDriveNext,
} from "@/lib/drive/sso";

const state = "a".repeat(43);
const prod = "https://drive.calibercode.io";
const staging = "https://drive-staging.calibercode.io";
const allowed = [prod, staging];

describe("drive sign-in links", () => {
	it("accepts only a 32-byte base64url state", () => {
		expect(isValidDriveState(state)).toBe(true);
		expect(isValidDriveState("a".repeat(42))).toBe(false);
		expect(isValidDriveState(`${"a".repeat(42)}=`)).toBe(false);
		expect(isValidDriveState(null)).toBe(false);
	});

	it("reads the allowed drive origins, ignoring anything that isn't a bare https origin", () => {
		expect(allowedDriveOrigins(`${prod}, ${staging}`)).toEqual(allowed);
		expect(allowedDriveOrigins("http://drive.example, https://drive.example/path, not a url, ")).toEqual([]);
		expect(allowedDriveOrigins(undefined)).toEqual([]);
	});

	it("only picks a drive origin that is exactly on the list", () => {
		expect(pickDriveOrigin(staging, allowed)).toBe(staging);
		expect(pickDriveOrigin(`${staging}/`, allowed)).toBeNull();
		expect(pickDriveOrigin("https://evil.example", allowed)).toBeNull();
		expect(pickDriveOrigin(undefined, allowed)).toBeNull();
	});

	it("only lets the login page return to /sso/drive with a valid state and an allowed drive", () => {
		const good = driveSsoPath(state, staging);
		expect(safeDriveNext(good, allowed)).toBe(good);
		for (const next of [
			"/inbox",
			"https://evil.example/sso/drive?state=x",
			"//evil.example",
			`/sso/drive?state=${state}`,
			driveSsoPath(state, "https://evil.example"),
			`${good}&next=//evil.example`,
			driveSsoPath("short", staging),
			`/sso/drive/../admin?state=${state}&drive=${encodeURIComponent(staging)}`,
			undefined,
			["/sso/drive"],
		]) {
			expect(safeDriveNext(next, allowed), String(next)).toBeNull();
		}
		expect(safeDriveNext(good, [])).toBeNull();
	});

	it("builds the drive callback from the chosen origin only", () => {
		const url = new URL(driveCallbackUrl(staging, "c0de", state));
		expect(url.origin).toBe(staging);
		expect(url.pathname).toBe("/auth/callback");
		expect(url.searchParams.get("code")).toBe("c0de");
		expect(url.searchParams.get("state")).toBe(state);
	});
});
