"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import type { SidebarProviderProps, SidebarState } from "./sidebar-state-types";

const SidebarContext = createContext<SidebarState>({
	minimal: false,
	narrow: false,
	mobileOpen: false,
	toggle: () => undefined,
	closeMobile: () => undefined,
});

/**
 * Desktop keeps the collapsible rail. Below 768px the navigation becomes a sheet that always
 * shows full labels, opens from the header, and closes on navigation (the sheet handles Escape).
 */
export function SidebarProvider({ children, expandedWidth = 240 }: SidebarProviderProps) {
	const pathname = usePathname();
	const [desktopMinimal, setDesktopMinimal] = useState(false);
	const [narrow, setNarrow] = useState(false);
	const [narrowExpanded, setNarrowExpanded] = useState(false);
	const [storageKey, setStorageKey] = useState<string | null>(null);
	const minimal = narrow ? false : desktopMinimal;
	const mobileOpen = narrow && narrowExpanded;

	useEffect(() => {
		const query = window.matchMedia("(max-width: 767px)");
		const update = () => {
			setNarrow(query.matches);
			if (!query.matches) setNarrowExpanded(false);
		};
		update();
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);

	useEffect(() => {
		setNarrowExpanded(false);
	}, [pathname]);

	useEffect(() => {
		void fetch("/api/auth/me", { cache: "no-store" })
			.then((response) => response.json() as Promise<{ user?: { id?: string } }>)
			.then((data) => {
				if (!data.user?.id) return;
				const key = `mailflare-sidebar-minimal:${data.user.id}`;
				setStorageKey(key);
				setDesktopMinimal(localStorage.getItem(key) === "true");
			});
	}, []);

	function toggle() {
		if (narrow) {
			setNarrowExpanded((current) => !current);
			return;
		}
		setDesktopMinimal((current) => {
			const next = !current;
			if (storageKey) localStorage.setItem(storageKey, String(next));
			return next;
		});
	}

	function closeMobile() {
		setNarrowExpanded(false);
	}

	return (
		<SidebarContext.Provider value={{ minimal, narrow, mobileOpen, toggle, closeMobile }}>
			<div
				className="h-full"
				style={
					{ "--sidebar-width": `${desktopMinimal ? 72 : expandedWidth}px` } as React.CSSProperties
				}
			>
				{children}
			</div>
		</SidebarContext.Provider>
	);
}

export function useSidebar() {
	return useContext(SidebarContext);
}
