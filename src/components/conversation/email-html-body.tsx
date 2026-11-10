"use client";

import { useLayoutEffect, useRef } from "react";

const PHONE_QUERY = "(max-width: 767px)";
/** Below this, text gets too small to read; the frame scrolls sideways instead. */
const MIN_SCALE = 0.5;
const BLOCK_SELECTOR = "table, td, th, div, center, section, article, p, blockquote, pre";
/** Original inline width of an element this component relaxed, or "" when it had none. */
const RELAXED_ATTRIBUTE = "data-fit-width";
const SCALED_ATTRIBUTE = "data-fit-scaled";

/** Puts back every width and scale this component changed, leaving the email as sent. */
function restoreEmail(content: HTMLElement) {
	for (const element of content.querySelectorAll<HTMLElement>(`[${RELAXED_ATTRIBUTE}]`)) {
		const original = element.getAttribute(RELAXED_ATTRIBUTE) ?? "";
		if (original) element.style.setProperty("width", original);
		else element.style.removeProperty("width");
		element.removeAttribute(RELAXED_ATTRIBUTE);
	}
	for (const element of content.querySelectorAll<HTMLElement>(`[${SCALED_ATTRIBUTE}]`)) {
		element.style.removeProperty("zoom");
		element.removeAttribute(SCALED_ATTRIBUTE);
	}
}

/** Blocks wider than the column, measured in one pass before anything is written. */
function findWideBlocks(content: HTMLElement, available: number) {
	return Array.from(content.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
		.map((element) => ({ element, width: element.getBoundingClientRect().width }))
		.filter(({ width }) => width > available + 1);
}

/**
 * Phone mail apps fit desktop-width email to the screen. The `.email-html` rules in globals.css
 * cap tables, images and blocks; this then lets any block with a hard-coded width wider than the
 * column fall back to `width: auto` so it reflows at full size. Only blocks that still can't fit
 * (rigid no-wrap rows) are scaled down, each on its own, so the rest of the email keeps its size.
 */
function fitEmail(frame: HTMLElement, content: HTMLElement) {
	restoreEmail(content);
	const available = frame.clientWidth;
	if (available <= 0 || content.scrollWidth <= available + 1) return;

	for (const { element } of findWideBlocks(content, available)) {
		element.setAttribute(RELAXED_ATTRIBUTE, element.style.getPropertyValue("width"));
		element.style.setProperty("width", "auto", "important");
	}
	if (content.scrollWidth <= available + 1) return;

	const stillWide = findWideBlocks(content, available);
	const outermost = stillWide.filter(
		({ element }) =>
			!stillWide.some((other) => other.element !== element && other.element.contains(element)),
	);
	for (const { element, width } of outermost) {
		element.setAttribute(SCALED_ATTRIBUTE, "");
		element.style.setProperty("zoom", String(Math.max(MIN_SCALE, available / width)));
	}
}

/** A sanitized HTML email, fitted to the screen on phones and untouched on desktop. */
export function EmailHtmlBody({ html }: Readonly<{ html: string }>) {
	const frameRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const frame = frameRef.current;
		const content = contentRef.current;
		if (!frame || !content) return;

		const query = window.matchMedia(PHONE_QUERY);
		let frameWidth = -1;
		let pending = 0;

		const fit = () => {
			if (query.matches) fitEmail(frame, content);
			else restoreEmail(content);
		};
		const scheduleFit = () => {
			cancelAnimationFrame(pending);
			pending = requestAnimationFrame(fit);
		};
		// Height changes caused by fitting itself must not trigger another pass.
		const observer = new ResizeObserver(() => {
			if (frame.clientWidth === frameWidth) return;
			frameWidth = frame.clientWidth;
			scheduleFit();
		});

		fit();
		observer.observe(frame);
		// Images without dimensions widen the layout once they load.
		content.addEventListener("load", scheduleFit, true);
		query.addEventListener("change", scheduleFit);
		return () => {
			cancelAnimationFrame(pending);
			observer.disconnect();
			content.removeEventListener("load", scheduleFit, true);
			query.removeEventListener("change", scheduleFit);
		};
	}, [html]);

	return (
		<div ref={frameRef} className="max-md:overflow-x-auto">
			<div ref={contentRef} className="email-html" dangerouslySetInnerHTML={{ __html: html }} />
		</div>
	);
}
