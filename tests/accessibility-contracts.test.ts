import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
	return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("accessibility and responsive route contracts", () => {
	it("provides a global skip link and stable main targets", () => {
		const rootLayout = source("src/app/layout.tsx");
		expect(rootLayout).toMatch(/className="[^"]*\bskip-link\b/);
		expect(rootLayout).toContain('href="#main-content"');

		for (const path of [
			"src/app/(dashboard)/layout.tsx",
			"src/app/(settings)/layout.tsx",
			"src/app/(admin)/layout.tsx",
			"src/components/auth/auth-shell.tsx",
		]) {
			const layout = source(path);
			expect(layout, path).toContain('id="main-content"');
			expect(layout, path).toContain("tabIndex={-1}");
		}
	});

	it("keeps global focus and reduced-motion fallbacks", () => {
		const css = source("src/app/globals.css");
		expect(css).toContain(":focus-visible");
		expect(css).toContain("@media (prefers-reduced-motion: reduce)");
		expect(css).toContain("transition-duration: 0.01ms !important");
		expect(css).toContain("touch-action: manipulation");
	});

	it("keeps the compact auth recovery link at readable contrast", () => {
		const login = source("src/app/(auth)/login/login-client.tsx");
		expect(login).toContain("text-[#6c6353]");
		expect(login).toContain("focus-visible:ring-[#8a4a11]");
		expect(login).not.toContain("text-[#a89c8b]");
	});

	it("labels mail search and preserves visible compound focus", () => {
		const search = source("src/components/mail-search/mail-search-input.tsx");
		expect(search).toContain('type="search"');
		expect(search).toContain('name="mail-search"');
		expect(search).toContain('aria-label="Search mail"');
		expect(search).toContain('autoComplete="off"');
		// Focus turns the pill white and lifts it with a shadow.
		expect(search).toContain("focus-within:bg-white");
		expect(search).toContain("focus-within:shadow-");
	});

	it("names compose fields and wraps actions on narrow screens", () => {
		const compose = source("src/components/compose/compose-form.tsx");
		const recipients = source("src/components/compose/recipient-field.tsx");
		const composeContext = source("src/components/compose/compose-context.tsx");
		for (const name of ["from", "subject", "body", "attachments"]) {
			expect(compose).toContain(`name="${name}"`);
		}
		expect(recipients).toContain("name={label.toLowerCase()}");
		expect(recipients).toContain("Backspace");
		expect(recipients).toContain("aria-label={`Remove");
		expect(compose).toContain("aria-expanded={showCc}");
		expect(compose).toContain("flex flex-wrap items-center");
		expect(compose).toContain("env(safe-area-inset-bottom)");
		expect(compose).toContain('aria-live="polite"');
		expect(compose).toContain("recipientInput.current?.focus()");
		expect(composeContext).toContain("returnFocusRef.current.focus()");
	});

	it("uses semantic conversation expand and collapse controls", () => {
		const conversation = source("src/components/conversation/conversation-message.tsx");
		const conversationView = source("src/components/conversation/conversation-view.tsx");
		expect(conversation).toContain('aria-label="Collapse message"');
		expect(conversation).toContain("onClick={onCollapse}");
		expect(conversation).not.toContain('.closest("button, a")');
		expect(conversation).toContain("focus-visible:ring-inset");
		// Icon-only expand control keeps an accessible name and a tooltip.
		expect(conversationView).toContain("`Expand all ${messages.length} messages`");
		expect(conversationView).toContain('label={allExpanded ? "Collapse all" : "Expand all"}');
	});

	it("keeps settings and calendar actions reachable at narrow widths", () => {
		const settingsLayout = source("src/app/(settings)/settings/layout.tsx");
		const settingsNav = source("src/components/settings/settings-nav.tsx");
		const calendar = source("src/app/(dashboard)/calendar/page.tsx");

		expect(settingsLayout).toContain("flex-col");
		expect(settingsLayout).toContain("lg:flex-row");
		expect(settingsNav).toContain("overflow-x-auto");
		expect(settingsNav).toContain("lg:w-64");
		expect(calendar).toContain("aria-busy=");
		expect(calendar).toContain('view === "month" && "min-w-[44rem]"');
		expect(calendar).toContain('view === "week" && "min-w-[56rem]"');
		expect(calendar).toContain('view === "day" && "min-w-[28rem]"');
	});

	it("defaults navigation to a compact rail without changing the desktop preference", () => {
		const sidebar = source("src/components/sidebar-state.tsx");
		expect(sidebar).toContain('window.matchMedia("(max-width: 767px)")');
		expect(sidebar).toContain("const minimal = narrow ? !narrowExpanded : desktopMinimal");
		expect(sidebar).toContain("localStorage.setItem(storageKey, String(next))");
	});

	it("announces page loading from the content area instead of a top progress bar", () => {
		const navigation = source("src/components/components-nav.tsx");
		expect(navigation).not.toContain('role="progressbar"');
		const spinner = source("src/components/ui/spinner.tsx");
		expect(spinner).toContain('role="status"');
		expect(spinner).toContain('aria-label="Loading"');
		expect(source("src/components/route-loading.tsx")).toContain("<Spinner");
	});
});
