import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";

describe("password hashing", () => {
	it("accepts the original password and rejects another password", () => {
		const hash = hashPassword("correct horse battery staple");

		expect(hash).not.toContain("correct horse battery staple");
		expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
		expect(verifyPassword("incorrect password", hash)).toBe(false);
	});
});
