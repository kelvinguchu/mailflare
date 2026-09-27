"use client";

import { useState } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ComposeProvider } from "@/components/compose/compose-context";
import { FloatingComposer } from "@/components/compose/floating-composer";
import { MailboxProvider } from "@/components/mailbox-provider";
import { AppHeaderActions } from "@/components/app-header-actions";
import { AdminNav } from "@/components/admin-nav";
import { SidebarProvider } from "@/components/sidebar-state";
import { DeadLetterAlert } from "@/components/dead-letter-alert";
import { MfaPolicyNotice } from "@/components/auth/mfa-policy-notice";
import { AdminHeaderSlotProvider } from "@/components/admin/admin-page-header";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
	const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
	return (
		<AuthGuard requireMailbox requireRole="admin">
			<SidebarProvider expandedWidth={256}>
				<MailboxProvider>
					<ComposeProvider>
						<div className="grid h-dvh grid-cols-[var(--sidebar-width)_minmax(0,1fr)] overflow-hidden bg-[#f6f8fc] transition-[grid-template-columns] duration-200 motion-reduce:transition-none">
							<aside
								aria-label="Administration navigation"
								className="min-h-0 overflow-y-auto overscroll-contain px-3 py-4 scrollbar-gutter-stable"
							>
								<AdminNav />
							</aside>
							<div className="flex min-h-0 min-w-0 flex-col">
								<header className="flex h-16 shrink-0 items-center gap-4 px-4 sm:px-6">
									<div ref={setHeaderSlot} className="flex min-w-0 flex-1 items-center" />
									<AppHeaderActions />
								</header>
								<MfaPolicyNotice />
								<main
									id="main-content"
									tabIndex={-1}
									className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 scrollbar-gutter-stable sm:px-6"
								>
									<div className="mx-auto min-h-full w-full max-w-[1600px] pb-10">
										<DeadLetterAlert />
										<AdminHeaderSlotProvider slot={headerSlot}>{children}</AdminHeaderSlotProvider>
									</div>
								</main>
							</div>
							<FloatingComposer />
						</div>
					</ComposeProvider>
				</MailboxProvider>
			</SidebarProvider>
		</AuthGuard>
	);
}
