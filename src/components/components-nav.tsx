import Link from "next/link";
import type { DragEvent, MouseEvent } from "react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import { getMessageDragData } from "@/lib/messages/drag-utils";
import { useSelectedMailbox } from "./mailbox-provider";
import { useSidebar } from "./sidebar-state";
import { useCompose } from "./compose/compose-context";
import { preloadMailboxPage } from "./components-nav-utils";
import type { NavLink } from "./components-nav-types";

export function NavItem({ link }: { link: NavLink }) {
	const pathname = usePathname();
	const { openComposer } = useCompose();
	const { selectedMailbox } = useSelectedMailbox();
	const { minimal } = useSidebar();
	const [dragOver, setDragOver] = useState(false);

	if (!link.href) {
		return <span className="flex-1" />;
	}

	const Icon = link.icon;
	if (!Icon) return null;
	const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
	const classes = cn(
		"flex h-9 items-center gap-3 rounded-r-full text-sm font-medium text-neutral-700 transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40",
		minimal && "relative mx-auto w-10 justify-center rounded-full px-0",
		active && "bg-primary/12 text-primary",
		dragOver && "bg-primary/8 text-primary ring-1 ring-primary/25",
		link.primary &&
			"mb-3 h-12 w-fit rounded-2xl bg-primary/12 px-5 text-primary shadow-sm hover:bg-primary/20",
		link.primary && minimal && "h-11 w-11 rounded-2xl px-0",
	);
	const dropProps = link.onMessageDrop
		? {
				onDragOver: (event: DragEvent) => {
					event.preventDefault();
					event.dataTransfer.dropEffect = "move";
					setDragOver(true);
				},
				onDragLeave: () => setDragOver(false),
				onDrop: (event: DragEvent) => {
					const payload = getMessageDragData(event.dataTransfer);
					setDragOver(false);
					if (!payload) return;
					event.preventDefault();
					link.onMessageDrop?.(payload.messageIds);
				},
			}
		: {};

	if (link.href === "/compose") {
		return (
			<button
				type="button"
				onClick={openComposer}
				className={classes}
				title={minimal ? link.label : undefined}
				aria-label={minimal ? link.label : undefined}
				{...dropProps}
			>
				<Icon aria-hidden="true" size={21} style={{ color: link.iconColor }} />
				{!minimal && <span className="flex-1">{link.label}</span>}
				{!minimal && typeof link.count === "number" && link.count > 0 && (
					<span className="ml-auto mr-3 rounded-full px-2 py-0.5 text-sm font-semibold text-neutral-700">
						{link.count > 99 ? "99+" : link.count}
					</span>
				)}
				{minimal && typeof link.count === "number" && link.count > 0 && (
					<span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-white">
						{link.count > 99 ? "99+" : link.count}
					</span>
				)}
			</button>
		);
	}

	// Navigation happens at once; the folder's first page starts loading alongside it, and the
	// content area shows its own spinner or skeleton until it arrives.
	function navigate(event: MouseEvent<HTMLAnchorElement>) {
		if (!link.preloadMessages || active || event.metaKey || event.ctrlKey || event.shiftKey) return;
		void preloadMailboxPage(link.href!, selectedMailbox?.id).catch(() => undefined);
	}

	return (
		<>
			<Link
				href={link.href}
				onClick={navigate}
				title={minimal ? link.label : undefined}
				aria-label={minimal ? link.label : undefined}
				aria-current={active ? "page" : undefined}
				className={cn(!minimal && "-ml-3 pl-6", classes)}
				{...dropProps}
			>
				<Icon
					aria-hidden="true"
					// className={minimal ? "h-4 w-4" : "h-5 w-5"}
					style={{ color: link.iconColor }}
					size={18}
				/>
				{!minimal && <span className="flex-1">{link.label}</span>}
				{!minimal && typeof link.count === "number" && link.count > 0 && (
					<span className="ml-auto mr-3 rounded-full px-2 py-0.5 text-sm font-semibold text-neutral-700">
						{link.count > 99 ? "99+" : link.count}
					</span>
				)}
				{minimal && typeof link.count === "number" && link.count > 0 && (
					<span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-white">
						{link.count > 99 ? "99+" : link.count}
					</span>
				)}
			</Link>
		</>
	);
}
