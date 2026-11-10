import type { ReactNode } from "react";

export type SidebarState = {
	minimal: boolean;
	narrow: boolean;
	/** True while the phone-width navigation drawer is showing. */
	mobileOpen: boolean;
	toggle(): void;
	closeMobile(): void;
};

export type SidebarProviderProps = {
	children: ReactNode;
	expandedWidth?: number;
};

export type SidebarHeaderProps = {
	href: string;
};

export type AppSidebarProps = {
	label: string;
	children: ReactNode;
};
