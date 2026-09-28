/**
 * @vitest-environment jsdom
 */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecipientField } from "../src/components/compose/recipient-field";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Suggestion = { email: string; displayName: string | null };

let root: Root;
let container: HTMLDivElement;
let value = "";
const requests: { query: string; signal: AbortSignal }[] = [];
let respond: (query: string) => Suggestion[];

function Harness({ initial, record }: { initial: string; record: (next: string) => void }) {
	const [recipients, setRecipients] = useState(initial);
	return createElement(RecipientField, {
		id: "to",
		label: "To",
		value: recipients,
		onChange: (next: string) => {
			record(next);
			setRecipients(next);
		},
	});
}

function record(next: string) {
	value = next;
}

const input = () => container.querySelector<HTMLInputElement>("input#to")!;
const options = () =>
	[...container.querySelectorAll<HTMLLIElement>('[role="option"]')].map((item) => item.textContent);

async function flush() {
	await act(async () => {
		await vi.runAllTimersAsync();
	});
}

async function type(text: string) {
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
		setter.call(input(), text);
		input().dispatchEvent(new Event("input", { bubbles: true }));
	});
}

async function key(name: string) {
	await act(async () => {
		input().dispatchEvent(
			new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
		);
	});
}

async function render(initial = "") {
	value = initial;
	await act(async () => {
		root.render(createElement(Harness, { initial, record }));
	});
	await act(async () => {
		input().focus();
	});
	await flush();
}

beforeEach(() => {
	vi.useFakeTimers();
	requests.length = 0;
	respond = () => [];
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init: RequestInit) => {
			expect(init.credentials).toBe("same-origin");
			const query = new URL(url, "http://localhost").searchParams.get("q") ?? "";
			requests.push({ query, signal: init.signal! });
			return new Response(JSON.stringify({ suggestions: respond(query) }));
		}),
	);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("RecipientField autocomplete", () => {
	it("shows recent contacts on focus, leaving out people already added", async () => {
		respond = () => [
			{ email: "amina@example.com", displayName: "Amina Wanjiku" },
			{ email: "kevo@example.com", displayName: null },
		];
		await render("Amina <AMINA@example.com>");
		expect(requests[0]?.query).toBe("");
		expect(options()).toEqual(["kevo@example.com"]);
	});

	it("debounces typing, cancels stale requests and shows matches", async () => {
		await render();
		respond = (query) =>
			query === "gra" ? [{ email: "grace@example.com", displayName: "Grace Muthoni" }] : [];
		const before = requests.length;
		await type("g");
		await type("gr");
		await type("gra");
		await flush();
		const typed = requests.slice(before).map((request) => request.query);
		expect(typed).toEqual(["gra"]);
		expect(options()).toEqual(["Grace Muthonigrace@example.com"]);

		await type("grac");
		await act(async () => {
			await vi.advanceTimersByTimeAsync(250);
		});
		await type("grace");
		await act(async () => {
			await vi.advanceTimersByTimeAsync(250);
		});
		const [older, newer] = requests.slice(-2);
		expect(older!.signal.aborted).toBe(true);
		expect(newer!.signal.aborted).toBe(false);
	});

	it("picks a suggestion with Down and Enter, keeping the display name", async () => {
		respond = () => [
			{ email: "grace@example.com", displayName: "Grace Muthoni" },
			{ email: "kevo@example.com", displayName: "Kevin, Otieno" },
		];
		await render();
		await key("ArrowDown");
		await key("ArrowDown");
		await key("Enter");
		expect(value).toBe('"Kevin, Otieno" <kevo@example.com>');
		expect(input().value).toBe("");
	});

	it("Up wraps to the last suggestion and Escape closes the list", async () => {
		respond = () => [
			{ email: "grace@example.com", displayName: null },
			{ email: "kevo@example.com", displayName: null },
		];
		await render();
		await key("ArrowUp");
		expect(input().getAttribute("aria-activedescendant")).toMatch(/-1$/);
		await key("Escape");
		expect(options()).toEqual([]);
		expect(input().getAttribute("aria-expanded")).toBe("false");
	});

	it("selects with the mouse without committing the half-typed text", async () => {
		await render();
		respond = () => [{ email: "grace@example.com", displayName: "Grace" }];
		await type("gr");
		await flush();
		const option = container.querySelector<HTMLLIElement>('[role="option"]')!;
		await act(async () => {
			const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
			option.dispatchEvent(down);
			expect(down.defaultPrevented).toBe(true);
			option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(value).toBe('"Grace" <grace@example.com>');
	});

	it("still adds a typed address with Enter when nothing is highlighted", async () => {
		respond = () => [{ email: "grace@example.com", displayName: "Grace" }];
		await render();
		await type("new.person@example.com");
		await key("Enter");
		expect(value).toBe("new.person@example.com");
	});
});
