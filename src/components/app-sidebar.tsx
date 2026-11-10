"use client";

import { Menu } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useSidebar } from "./sidebar-state";
import type { AppSidebarProps } from "./sidebar-state-types";

/**
 * The app's navigation column. From 768px up it is the grid's first column, exactly as before;
 * below that it is a drawer over the content with a dimmed backdrop.
 */
export function AppSidebar({ label, children }: AppSidebarProps) {
	const { mobileOpen, closeMobile } = useSidebar();
	const asideRef = useRef<HTMLElement>(null);

	useEffect(() => {
		if (mobileOpen) asideRef.current?.focus();
	}, [mobileOpen]);

	return (
		<>
			<button
				type="button"
				tabIndex={-1}
				aria-label="Close navigation"
				onClick={closeMobile}
				className={cn(
					"fixed inset-0 z-40 bg-neutral-950/40 transition-opacity duration-200 motion-reduce:transition-none md:hidden",
					mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
				)}
			/>
			<aside
				ref={asideRef}
				aria-label={label}
				tabIndex={-1}
				className={cn(
					"min-h-0 overflow-y-auto overscroll-contain px-3 py-4 outline-none scrollbar-gutter-stable",
					"max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-72 max-md:max-w-[85vw] max-md:bg-[#f6f8fc] max-md:pb-[calc(1rem+env(safe-area-inset-bottom))] max-md:shadow-xl max-md:transition-[transform,visibility] max-md:duration-200 max-md:motion-reduce:transition-none",
					!mobileOpen && "max-md:invisible max-md:-translate-x-full",
				)}
			>
				{children}
			</aside>
		</>
	);
}

/** Opens the navigation drawer; only shown below 768px, where the sidebar is hidden. */
export function MobileNavButton() {
	const { mobileOpen, toggle } = useSidebar();
	return (
		<button
			type="button"
			onClick={toggle}
			aria-label="Open navigation"
			aria-expanded={mobileOpen}
			aria-controls="primary-navigation"
			className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-200 focus-visible:ring-2 focus-visible:ring-primary/40 md:hidden"
		>
			<Menu aria-hidden="true" className="size-5" />
		</button>
	);
}
