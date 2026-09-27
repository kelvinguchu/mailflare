import type { ReactNode } from "react";

export type SidebarState = {
	minimal: boolean;
	narrow: boolean;
	toggle(): void;
};

export type SidebarProviderProps = {
	children: ReactNode;
	expandedWidth?: number;
};

export type SidebarHeaderProps = {
	href: string;
};
