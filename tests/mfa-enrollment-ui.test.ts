// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { encode } from "uqr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

type Reply = { status: number; body: unknown };
const replies: Record<string, Reply[]> = {};
const requests: Array<{ method: string; body: unknown }> = [];

vi.mock("@/lib/auth/client", () => ({
	authFetch: vi.fn(async (_url: string, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		requests.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		const reply = replies[method]?.shift();
		if (!reply) throw new TypeError(`No reply queued for ${method}`);
		return new Response(JSON.stringify(reply.body), { status: reply.status });
	}),
	notifyAuthSessionChanged: vi.fn(),
}));

const { MfaSettings } = await import("../src/components/settings/mfa-settings");
const { MfaEnrollment } = await import("../src/components/auth/mfa-enrollment");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no PointerEvent; Base UI's checkbox dispatches one for label clicks.
if (!("PointerEvent" in window)) {
	Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });
}

const OTPAUTH =
	"otpauth://totp/CC%20Mail:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=CC%20Mail";
const STATUS = (enabled: boolean, state = "restricted") => ({
	status: 200,
	body: {
		enabled,
		recoveryCodesRemaining: enabled ? 10 : 0,
		policy: { state, required: true, deadline: null, exemptUntil: null },
	},
});

let container: HTMLDivElement;
let root: Root;

function queue(method: string, ...items: Reply[]) {
	replies[method] = [...(replies[method] ?? []), ...items];
}

async function flush() {
	await act(async () => {
		for (let index = 0; index < 5; index += 1) await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

function byText<T extends Element>(selector: string, text: string): T {
	const match = Array.from(container.querySelectorAll<T>(selector)).find((element) =>
		element.textContent?.includes(text),
	);
	if (!match) throw new Error(`No ${selector} containing "${text}"`);
	return match;
}

function typeInto(input: HTMLInputElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
	act(() => {
		setter?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

async function click(element: Element) {
	await act(async () => {
		(element as HTMLElement).click();
	});
	await flush();
}

async function startSetup() {
	queue("GET", STATUS(false));
	await act(async () => root.render(createElement(MfaSettings, { enrollmentMode: true })));
	await flush();
	const password = container.querySelector<HTMLInputElement>("input[type='password']");
	if (!password) throw new Error("Password field missing");
	typeInto(password, "correct horse battery staple");
	queue("POST", { status: 200, body: { secret: "JBSWY3DPEHPK3PXP", otpauthUri: OTPAUTH } });
	await click(byText("button", "Create authenticator key"));
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	for (const key of Object.keys(replies)) delete replies[key];
	requests.length = 0;
	router.replace.mockClear();
	router.refresh.mockClear();
	localStorage.clear();
	sessionStorage.clear();
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText: vi.fn(async () => undefined) },
	});
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

describe("MFA enrollment", () => {
	it("renders the QR code locally from the exact otpauth URI and keeps the manual key", async () => {
		await startSetup();
		const svg = container.querySelector("svg[role='img']");
		expect(svg?.getAttribute("aria-label")).toMatch(/authenticator app/);
		const expected = encode(OTPAUTH, { ecc: "M", border: 0 }).data;
		expect(Number(svg?.getAttribute("data-qr-size"))).toBe(expected.length);
		const darkModules = expected.flat().filter(Boolean).length;
		expect(svg?.querySelector("path")?.getAttribute("d")?.match(/M/g)).toHaveLength(darkModules);
		expect(container.textContent).toContain("JBSW Y3DP EHPK 3PXP");
		expect(document.activeElement?.textContent).toBe("Set up your authenticator app");

		await click(byText("button", "Copy setup key"));
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith("JBSWY3DPEHPK3PXP");
		expect(container.querySelector("[role='status']")?.textContent).toBeDefined();
	});

	it("uses a mobile-friendly one-time-code field and explains invalid codes on the field", async () => {
		await startSetup();
		const code = container.querySelector<HTMLInputElement>("input[name='code']");
		expect(code?.getAttribute("autocomplete")).toBe("one-time-code");
		expect(code?.getAttribute("inputmode")).toBe("numeric");

		typeInto(code!, "12");
		await click(byText("button", "Verify and turn on"));
		expect(code?.getAttribute("aria-invalid")).toBe("true");
		expect(document.getElementById(code!.getAttribute("aria-describedby")!)?.textContent).toMatch(
			/six-digit/,
		);
		expect(document.activeElement).toBe(code);

		typeInto(code!, "123456");
		queue("PUT", { status: 401, body: { error: "Invalid verification code" } });
		await click(byText("button", "Verify and turn on"));
		expect(requests.at(-1)).toEqual({ method: "PUT", body: { code: "123456" } });
		expect(container.querySelector("[role='alert']")?.textContent).toMatch(/didn’t match/);
	});

	it("keeps recovery codes on screen until the user confirms they saved them", async () => {
		await startSetup();
		const hrefBefore = window.location.href;
		typeInto(container.querySelector<HTMLInputElement>("input[name='code']")!, "123456");
		queue("PUT", { status: 200, body: { ok: true, recoveryCodes: ["alpha-1111", "bravo-2222"] } });
		await click(byText("button", "Verify and turn on"));

		expect(router.replace).not.toHaveBeenCalled();
		expect(container.textContent).toContain("alpha-1111");
		expect(document.activeElement?.tagName).toBe("H3");
		const continueButton = byText<HTMLButtonElement>("button", "Continue to CC Mail");
		expect(continueButton.disabled).toBe(true);

		expect(localStorage.length).toBe(0);
		expect(sessionStorage.length).toBe(0);
		expect(window.location.href).toBe(hrefBefore);
		expect(window.location.href).not.toContain("alpha-1111");

		await click(container.querySelector("[data-testid='recovery-codes-saved']")!);
		expect(continueButton.disabled).toBe(false);
		await click(continueButton);
		expect(router.replace).toHaveBeenCalledWith("/inbox");
	});

	it("returns to the password step when the setup key expired", async () => {
		await startSetup();
		typeInto(container.querySelector<HTMLInputElement>("input[name='code']")!, "123456");
		queue("PUT", { status: 409, body: { error: "Start multi-factor setup first" } });
		await click(byText("button", "Verify and turn on"));
		expect(container.textContent).toContain("setup key expired");
		expect(container.querySelector("input[type='password']")).not.toBeNull();
	});

	it("reports a wrong password beside the field and keeps focus there", async () => {
		queue("GET", STATUS(false));
		await act(async () => root.render(createElement(MfaSettings)));
		await flush();
		const password = container.querySelector<HTMLInputElement>("input[type='password']")!;
		typeInto(password, "wrong");
		queue("POST", { status: 401, body: { error: "Invalid password" } });
		await click(byText("button", "Create authenticator key"));
		expect(container.querySelector("[role='alert']")?.textContent).toBe(
			"That password is incorrect.",
		);
		expect(document.activeElement).toBe(password);
	});

	it("accepts letters in authenticator-or-recovery-code fields", async () => {
		queue("GET", STATUS(true, "compliant"));
		await act(async () => root.render(createElement(MfaSettings)));
		await flush();
		const codeFields = container.querySelectorAll<HTMLInputElement>("input[name='code']");
		expect(codeFields.length).toBeGreaterThan(0);
		for (const field of codeFields) expect(field.getAttribute("inputmode")).toBeNull();
	});

	it("keeps sign-out and account recovery available to restricted users", async () => {
		queue("GET", STATUS(false));
		await act(async () => root.render(createElement(MfaEnrollment)));
		await flush();
		expect(byText("button", "Sign out")).toBeTruthy();
		expect(byText("button", "Recover account")).toBeTruthy();
	});
});
