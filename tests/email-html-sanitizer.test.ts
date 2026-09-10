import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { JSDOM, ResourceLoader } from "jsdom";
import { sanitizeEmailHtml } from "../src/app/(dashboard)/inbox/[messageId]/email-html-sanitizer";

class RecordingResourceLoader extends ResourceLoader {
	readonly requests: string[] = [];

	override fetch(url: string): null {
		this.requests.push(url);
		return null;
	}
}

const resourceLoader = new RecordingResourceLoader();
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "https://mail.example.test/inbox/message-1",
	resources: resourceLoader,
});

beforeAll(() => {
	vi.stubGlobal("window", dom.window);
	vi.stubGlobal("document", dom.window.document);
	vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
});

afterAll(() => {
	vi.unstubAllGlobals();
	dom.window.close();
});

function parseFragment(html: string | null): DocumentFragment {
	const template = dom.window.document.createElement("template");
	template.innerHTML = html ?? "";
	return template.content;
}

describe("email HTML sanitizer", () => {
	it("blocks remote images without initiating a tracking request", async () => {
		const result = sanitizeEmailHtml(
			'<p>Hello</p><img src="https://tracker.example/pixel.gif?id=1"><img src="//cdn.example/photo.png">',
		);

		expect(result.blockedRemoteImageCount).toBe(2);
		expect(parseFragment(result.html).querySelectorAll("img")).toHaveLength(0);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(resourceLoader.requests).toEqual([]);
	});

	it("loads remote images only after explicit opt-in and suppresses referrers", () => {
		const result = sanitizeEmailHtml(
			'<img alt="Newsletter" src="https://images.example/news.png">',
			{ allowRemoteImages: true },
		);
		const image = parseFragment(result.html).querySelector("img");

		expect(result.blockedRemoteImageCount).toBe(0);
		expect(image?.getAttribute("src")).toBe("https://images.example/news.png");
		expect(image?.getAttribute("loading")).toBe("lazy");
		expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
	});

	it("keeps local inline attachments and safe raster data images", () => {
		const result = sanitizeEmailHtml(
			'<img src="/api/messages/msg-1/attachments/att-1?preview=1"><img src="data:image/png;base64,iVBORw0KGgo=">',
		);
		const images = parseFragment(result.html).querySelectorAll("img");

		expect(result.blockedRemoteImageCount).toBe(0);
		expect(images).toHaveLength(2);
	});

	it("rejects SVG, executable data URLs, unresolved content IDs, and arbitrary local paths", () => {
		const result = sanitizeEmailHtml(
			[
				'<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">',
				'<img src="data:text/html;base64,PHNjcmlwdD4=">',
				'<img src="cid:tracking-pixel">',
				'<img src="/api/session">',
			].join(""),
		);

		expect(parseFragment(result.html).querySelectorAll("img")).toHaveLength(0);
		expect(result.blockedRemoteImageCount).toBe(0);
	});

	it("drops active content and event-handler attributes", () => {
		const result = sanitizeEmailHtml(
			[
				'<div onclick="alert(1)">Safe text</div>',
				'<script>alert(1)</script>',
				'<style>body{background:url(https://tracker.example/css)}</style>',
				'<iframe src="https://tracker.example/frame"></iframe>',
				'<svg><a href="javascript:alert(1)"><text>bad</text></a></svg>',
				'<math><mtext>bad</mtext></math>',
				'<form action="https://evil.example"><input name="secret"></form>',
			].join(""),
		);
		const fragment = parseFragment(result.html);

		expect(fragment.textContent).toContain("Safe text");
		expect(fragment.querySelector("div")?.hasAttribute("onclick")).toBe(false);
		expect(fragment.querySelector("script, style, iframe, svg, math, form, input")).toBeNull();
		expect(result.html).not.toContain("tracker.example");
	});

	it("allows safe links while neutralizing executable URLs", () => {
		const result = sanitizeEmailHtml(
			[
				'<a id="safe" href="https://example.test/path">Safe</a>',
				'<a id="mail" href="mailto:person@example.test">Mail</a>',
				'<a id="js" href="javascript:alert(1)">JS</a>',
				'<a id="data" href="data:text/html,boom">Data</a>',
				'<a id="relative" href="/api/auth/logout">Relative</a>',
			].join(""),
		);
		const fragment = parseFragment(result.html);
		const safeLink = Array.from(fragment.querySelectorAll("a"))
			.find((link) => link.textContent === "Safe");
		const unsafeLinks = Array.from(fragment.querySelectorAll("a"))
			.filter((link) => ["JS", "Data", "Relative"].includes(link.textContent ?? ""));

		expect(safeLink?.getAttribute("target")).toBe("_blank");
		expect(safeLink?.getAttribute("rel")).toBe("noopener noreferrer");
		expect(unsafeLinks.every((link) => !link.hasAttribute("href"))).toBe(true);
	});

	it("does not report images nested inside content that is dropped wholesale", () => {
		const result = sanitizeEmailHtml(
			'<form><img src="https://tracker.example/hidden.png"></form>',
		);

		expect(result.html).toBe("");
		expect(result.blockedRemoteImageCount).toBe(0);
	});

	it("keeps allowlisted presentation styles and removes resource-bearing or escaped CSS", () => {
		const result = sanitizeEmailHtml(
			'<p style="color: rgb(1, 2, 3); font-family: Arial; background-image: url(https://tracker.example/pixel); position: fixed; width: c\\61lc(100%)">Styled</p>',
		);
		const style = parseFragment(result.html).querySelector("p")?.getAttribute("style") ?? "";

		expect(style).toContain("color: rgb(1, 2, 3)");
		expect(style).toContain("font-family: Arial");
		expect(style).toContain("var(--font-geist-sans)");
		expect(style).not.toContain("url(");
		expect(style).not.toContain("position");
		expect(style).not.toContain("c\\61lc");
	});

	it("unwraps unknown formatting tags but preserves their safe text", () => {
		const result = sanitizeEmailHtml("<custom-wrapper><strong>Kept</strong></custom-wrapper>");
		const fragment = parseFragment(result.html);

		expect(fragment.querySelector("custom-wrapper")).toBeNull();
		expect(fragment.querySelector("strong")?.textContent).toBe("Kept");
	});
});
