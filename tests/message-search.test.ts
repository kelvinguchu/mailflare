import { describe, expect, it } from "vitest";
import { getContainsPattern } from "../src/lib/messages/search";

describe("message search", () => {
	it("builds a contains pattern", () => {
		expect(getContainsPattern("invoice")).toBe("%invoice%");
	});

	it("treats LIKE wildcard characters as literal search text", () => {
		expect(getContainsPattern("50%_off\\today")).toBe("%50\\%\\_off\\\\today%");
	});
});
