"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { SidebarProviderProps, SidebarState } from "./sidebar-state-types";

const SidebarContext = createContext<SidebarState>({
	minimal: false,
	narrow: false,
	toggle: () => undefined,
});

export function SidebarProvider({ children, expandedWidth = 240 }: SidebarProviderProps) {
	const [desktopMinimal, setDesktopMinimal] = useState(false);
	const [narrow, setNarrow] = useState(false);
	const [narrowExpanded, setNarrowExpanded] = useState(false);
	const [storageKey, setStorageKey] = useState<string | null>(null);
	const minimal = narrow ? !narrowExpanded : desktopMinimal;

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

	return (
		<SidebarContext.Provider value={{ minimal, narrow, toggle }}>
			<div
				className="h-full"
				style={{ "--sidebar-width": `${minimal ? 72 : expandedWidth}px` } as React.CSSProperties}
			>
				{children}
			</div>
		</SidebarContext.Provider>
	);
}

export function useSidebar() {
	return useContext(SidebarContext);
}
