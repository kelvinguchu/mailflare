"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const HeaderSlotContext = createContext<HTMLElement | null>(null);

/** Owns the admin top bar's title area so each page can fill it without a second heading row. */
export function AdminHeaderSlotProvider({
	slot,
	children,
}: Readonly<{ slot: HTMLElement | null; children: ReactNode }>) {
	return <HeaderSlotContext.Provider value={slot}>{children}</HeaderSlotContext.Provider>;
}

/**
 * Renders the page title and page actions in the admin top bar.
 * The heading stays the page's only `h1`; before the bar mounts it renders nothing.
 */
export function AdminPageHeader({
	title,
	actions,
}: Readonly<{
	title: ReactNode;
	actions?: ReactNode;
}>) {
	const slot = useContext(HeaderSlotContext);
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	if (!slot || !mounted) return null;

	return createPortal(
		<div className="flex min-w-0 flex-1 items-center gap-4">
			<h1 className="min-w-0 flex-1 truncate text-[22px] leading-tight font-normal text-neutral-900">
				{title}
			</h1>
			{actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
		</div>,
		slot,
	);
}
