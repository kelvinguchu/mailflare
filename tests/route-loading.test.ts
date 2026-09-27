// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const authFetch = vi.fn();

vi.mock("next/navigation", () => ({
	usePathname: () => "/inbox",
	useRouter: () => ({ replace }),
}));
vi.mock("next/image", () => ({
	default: ({ alt }: { alt: string }) => createElement("img", { alt }),
}));
vi.mock("@/components/branding-provider", () => ({
	useBranding: () => ({ appName: "CC Mail", iconUrl: "/cc-mail-logo.png" }),
}));
vi.mock("@/lib/auth/client", () => ({
	authFetch: (...args: unknown[]) => authFetch(...args),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { AuthGuard } = await import("../src/components/auth/auth-guard");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	authFetch.mockResolvedValue(
		new Response(JSON.stringify({ user: { role: "member" }, hasMailboxes: true }), {
			status: 200,
		}),
	);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

function overlay() {
	return container.querySelector("[data-slot='bootstrap-overlay']");
}

async function mountGuard(props: { requireRole?: "admin" } = {}) {
	await act(async () => {
		root.render(createElement(AuthGuard, props, createElement("p", { id: "shell" }, "Shell")));
	});
}

describe("page-to-page loading", () => {
	it("shows the full-screen overlay on the first load only", async () => {
		act(() => {
			root.render(createElement(AuthGuard, {}, createElement("p", { id: "shell" }, "Shell")));
		});
		expect(overlay()).not.toBeNull();
		await act(async () => undefined);
		expect(container.querySelector("#shell")).not.toBeNull();

		// A different route group mounts a fresh guard; the confirmed session skips the overlay.
		act(() => root.unmount());
		root = createRoot(container);
		act(() => {
			root.render(createElement(AuthGuard, {}, createElement("p", { id: "shell" }, "Shell")));
		});
		expect(overlay()).toBeNull();
		expect(container.querySelector("#shell")).not.toBeNull();
	});

	it("still waits for the role check before showing admin pages", async () => {
		await mountGuard();
		act(() => root.unmount());
		root = createRoot(container);
		act(() => {
			root.render(
				createElement(
					AuthGuard,
					{ requireRole: "admin" },
					createElement("p", { id: "shell" }, "Shell"),
				),
			);
		});
		expect(overlay()).not.toBeNull();
	});

	it("uses a content-area spinner for route loading in every app shell", () => {
		for (const group of ["(dashboard)", "(settings)", "(admin)"]) {
			const source = readFileSync(
				path.join(import.meta.dirname, `../src/app/${group}/loading.tsx`),
				"utf8",
			);
			expect(source, group).toContain("RouteLoading");
		}
	});
});
