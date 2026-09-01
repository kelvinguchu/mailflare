import { afterEach, describe, expect, it, vi } from "vitest";
import { authFetch } from "../src/lib/auth/client";
import { createAuthenticatedResponse } from "../src/lib/auth/http-response";

describe("browser authentication", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses same-origin cookies without adding a bearer token", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetchMock);

		await authFetch("/api/mailboxes", {
			headers: { "X-Test": "present" },
			redirectOnUnauthorized: false,
		});

		const requestInit = fetchMock.mock.calls[0]?.[1];
		const headers = new Headers(requestInit?.headers);
		expect(requestInit?.credentials).toBe("same-origin");
		expect(headers.get("Authorization")).toBeNull();
		expect(headers.get("X-Test")).toBe("present");
	});

	it("returns the session secret only through an HttpOnly cookie", async () => {
		const response = createAuthenticatedResponse("sess_private", "/inbox");

		expect(await response.json()).toEqual({ ok: true, redirect: "/inbox" });
		expect(response.headers.get("Set-Cookie")).toContain("ep_session=sess_private");
		expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
		expect(response.headers.get("Set-Cookie")).toContain("SameSite=lax");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
	});
});
