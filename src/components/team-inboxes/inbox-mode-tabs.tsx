"use client";

import Link from "next/link";

import { usePathname } from "next/navigation";

import { useEffect, useState } from "react";

import { authFetch, AUTH_SESSION_CHANGED_EVENT } from "@/lib/auth/client";

/** "My Inbox" is the fallback for every other page, so its prefix matches everything. */
const TABS = [
	{ href: "/inbox", prefix: "", label: "My Inbox" },
	{ href: "/team-inboxes", prefix: "/team-inboxes", label: "Team’s inbox" },
	{ href: "/team-calendar", prefix: "/team-calendar", label: "Team’s calendar" },
];

export function InboxModeTabs() {
	const pathname = usePathname();
	const [allowed, setAllowed] = useState(false);

	useEffect(() => {
		const controller = new AbortController();
		let current = true;

		const reset = () => {
			current = false;
			setAllowed(false);
			controller.abort();
		};

		window.addEventListener(AUTH_SESSION_CHANGED_EVENT, reset);

		void authFetch("/api/auth/me", { cache: "no-store", signal: controller.signal })
			.then(async (r) =>
				r.ok ? (r.json() as Promise<{ user?: { canInspectTeam?: boolean } }>) : null,
			)
			.then((data) => {
				if (current) setAllowed(!!data?.user?.canInspectTeam);
			})
			.catch(() => {});

		return () => {
			reset();
			window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, reset);
		};
	}, [pathname]);

	if (!allowed) return null;

	const active = TABS.findLast((tab) => pathname.startsWith(tab.prefix))?.href ?? "/inbox";

	return (
		<nav
			aria-label="Inbox mode"
			className="flex shrink-0 gap-2 overflow-x-auto border-b border-neutral-200 px-4 py-2 max-sm:gap-1 max-sm:px-2"
		>
			{TABS.map((tab) => (
				<Link
					key={tab.href}
					href={tab.href}
					aria-current={active === tab.href ? "page" : undefined}
					className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold max-sm:px-2.5 ${active === tab.href ? "bg-primary/10 text-primary" : "text-neutral-600"}`}
				>
					{tab.label}
				</Link>
			))}
		</nav>
	);
}
