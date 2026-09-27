"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActiveSettingsPath, settingsNavSections } from "./settings-nav-utils";

export function SettingsNav() {
	const pathname = usePathname();

	return (
		<aside
			aria-label="Settings navigation"
			className="order-first w-full shrink-0 border-b border-primary/15 px-3 py-3 lg:order-last lg:min-h-full lg:w-64 lg:border-r lg:border-b-0 lg:px-4 lg:py-10"
		>
			<div className="flex gap-5 overflow-x-auto overscroll-x-contain pb-1 lg:sticky lg:top-6 lg:block lg:space-y-7 lg:overflow-visible lg:pb-0">
				{settingsNavSections.map((section) => (
					<div
						key={section.label}
						className="flex shrink-0 items-center gap-2 lg:block lg:space-y-3"
					>
						<h2 className="sr-only px-4 text-xs font-semibold tracking-wide text-neutral-500 uppercase lg:not-sr-only">
							{section.label}
						</h2>
						<nav
							aria-label={`${section.label} settings`}
							className="flex gap-1 lg:block lg:space-y-px"
						>
							{section.items.map((item) => {
								const active = isActiveSettingsPath(pathname, item.href);
								return (
									<Link
										key={item.href}
										href={item.href}
										className={cn(
											"block min-h-9 rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
											active
												? "bg-primary/12 text-primary"
												: "text-neutral-600 hover:bg-white/70 hover:text-neutral-900",
										)}
										aria-current={active ? "page" : undefined}
									>
										{item.label}
									</Link>
								);
							})}
						</nav>
					</div>
				))}
			</div>
		</aside>
	);
}
