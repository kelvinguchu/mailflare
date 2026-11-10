"use client";

import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useSidebar } from "./sidebar-state";
import type { AppSidebarProps } from "./sidebar-state-types";

/**
 * The app's navigation. From 768px up it is the grid's first column, exactly as before; below
 * that it opens from the header as a left-hand sheet. Only one copy of the navigation is mounted
 * at a time, so its data loads and its element ids stay unique.
 */
export function AppSidebar({ label, children }: AppSidebarProps) {
	const { narrow, mobileOpen, closeMobile } = useSidebar();

	return (
		<>
			<aside
				aria-label={label}
				className="min-h-0 overflow-y-auto overscroll-contain px-3 py-4 scrollbar-gutter-stable max-md:hidden"
			>
				{!narrow && children}
			</aside>
			{narrow && (
				<Sheet
					open={mobileOpen}
					onOpenChange={(open) => {
						if (!open) closeMobile();
					}}
				>
					<SheetContent
						side="left"
						showCloseButton={false}
						aria-label={label}
						className="gap-0 overflow-y-auto overscroll-contain bg-[#f6f8fc] px-3 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] data-[side=left]:w-72 data-[side=left]:max-w-[85vw]"
					>
						<SheetTitle className="sr-only">{label}</SheetTitle>
						{children}
					</SheetContent>
				</Sheet>
			)}
		</>
	);
}

/** Opens the navigation sheet; only shown below 768px, where the sidebar column is hidden. */
export function MobileNavButton() {
	const { mobileOpen, toggle } = useSidebar();
	return (
		<button
			type="button"
			onClick={toggle}
			aria-label="Open navigation"
			aria-expanded={mobileOpen}
			aria-haspopup="dialog"
			className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-200 focus-visible:ring-2 focus-visible:ring-primary/40 md:hidden"
		>
			<Menu aria-hidden="true" className="size-5" />
		</button>
	);
}
