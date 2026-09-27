// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoadingTransition } from "../src/components/loading-transition";

vi.mock("next/image", () => ({
	default: ({ alt }: { alt: string }) => createElement("img", { alt }),
}));
vi.mock("@/components/branding-provider", () => ({
	useBranding: () => ({ appName: "CC Mail", iconUrl: "/cc-mail-logo.png" }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = path.join(import.meta.dirname, "../src");

function sourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const full = path.join(directory, entry);
		if (statSync(full).isDirectory()) return sourceFiles(full);
		return /\.(ts|tsx)$/.test(entry) ? [full] : [];
	});
}

function read(relative: string): string {
	return readFileSync(path.join(SRC, relative), "utf8");
}

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	queryClient.clear();
});

function renderTransition(ready: boolean, children: ReactNode) {
	act(() => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client: queryClient },
				createElement(LoadingTransition, { ready }, children),
			),
		);
	});
}

function overlay() {
	return container.querySelector("[data-slot='bootstrap-overlay']");
}

function SlowSecondaryQuery() {
	useQuery({ queryKey: ["slow-secondary"], queryFn: () => new Promise<never>(() => undefined) });
	return createElement("p", { id: "shell" }, "Inbox shell");
}

describe("bootstrap loading overlay", () => {
	it("blocks protected content until the authorization decision is made", () => {
		renderTransition(false, createElement("p", { id: "shell" }, "Inbox shell"));
		expect(overlay()).not.toBeNull();
		expect(overlay()?.getAttribute("role")).toBe("status");
		expect(container.querySelector("#shell")).toBeNull();
	});

	it("reveals the shell immediately once authorized, even while a slow query is pending", () => {
		renderTransition(false, createElement(SlowSecondaryQuery));
		renderTransition(true, createElement(SlowSecondaryQuery));
		expect(queryClient.isFetching()).toBeGreaterThan(0);
		expect(overlay()).toBeNull();
		expect(container.querySelector("#shell")?.textContent).toBe("Inbox shell");
	});

	it("never covers the shell again after it has been revealed", () => {
		renderTransition(true, createElement("p", { id: "shell" }, "Inbox shell"));
		renderTransition(false, createElement("p", { id: "shell" }, "Inbox shell"));
		act(() => void queryClient.invalidateQueries());
		expect(overlay()).toBeNull();
		expect(container.querySelector("#shell")).not.toBeNull();
	});
});

describe("local loading contracts", () => {
	it("does not decide whole-app visibility from global fetching state", () => {
		for (const file of sourceFiles(SRC)) {
			expect(readFileSync(file, "utf8"), path.relative(SRC, file)).not.toMatch(/useIsFetching/);
		}
		expect(sourceFiles(SRC).some((file) => file.endsWith("page-loading.tsx"))).toBe(false);
	});

	it("adds no artificial wait or delayed fade to the bootstrap overlay", () => {
		const transition = read("components/loading-transition.tsx");
		expect(transition).not.toMatch(/setTimeout|setInterval|transition-opacity/);
	});

	it("keeps list rows during refreshes and uses a local skeleton only for the first load", () => {
		const list = read("components/messages/message-folder-page.tsx");
		expect(list).toMatch(
			/initialLoading = \(mailboxesLoading \|\| isLoading\) && messages\.length === 0/,
		);
		expect(list).toMatch(/refreshing = isLoading && messages\.length > 0/);
		expect(list).toMatch(/<SkeletonRows/);
		expect(list).toMatch(/aria-busy=\{isLoading\}/);
	});

	it("shows the message skeleton only while a conversation has no data yet", () => {
		const conversation = read("components/conversation/conversation-view.tsx");
		expect(conversation).toMatch(/if \(loading && !thread\) return <MessageDetailSkeleton \/>/);
	});

	it("keeps calendar data visible between range changes", () => {
		expect(read("app/(dashboard)/calendar/page.tsx")).toMatch(/placeholderData: keepPreviousData/);
	});
});
