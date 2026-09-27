"use client";

import Link from "next/link";
import { Settings } from "lucide-react";
import { MailboxSelector } from "@/components/mailbox-selector";
import { NotificationsMenu } from "@/components/notifications-menu";
import { Tooltip } from "@/components/ui/tooltip";

/** The right side of every app header: notifications, settings, and the account menu. */
export function AppHeaderActions() {
	return (
		<div className="flex shrink-0 items-center gap-1">
			<NotificationsMenu />
			<Tooltip label="Settings">
				<Link
					href="/settings"
					aria-label="Settings"
					className="flex size-10 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-200 focus-visible:ring-2 focus-visible:ring-primary/40"
				>
					<Settings aria-hidden="true" className="size-5" />
				</Link>
			</Tooltip>
			<MailboxSelector />
		</div>
	);
}
