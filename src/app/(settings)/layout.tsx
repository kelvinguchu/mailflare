"use client";

import { AuthGuard } from "@/components/auth/auth-guard";
import { ComposeProvider } from "@/components/compose/compose-context";
import { FloatingComposer } from "@/components/compose/floating-composer";
import { MailSearchInput } from "@/components/mail-search/mail-search-input";
import { MailSearchProvider } from "@/components/mail-search/mail-search-context";
import { MailboxProvider } from "@/components/mailbox-provider";
import { AppHeaderActions } from "@/components/app-header-actions";
import { DashboardNav } from "@/components/dashboard-nav";
import { SidebarProvider } from "@/components/sidebar-state";
import { MfaPolicyNotice } from "@/components/auth/mfa-policy-notice";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
	return (
		<AuthGuard>
			<SidebarProvider>
				<MailboxProvider>
					<ComposeProvider>
						<MailSearchProvider>
							<div className="grid h-[100dvh] grid-cols-[var(--sidebar-width)_minmax(0,1fr)] overflow-hidden bg-[#f6f8fc] transition-[grid-template-columns] duration-200 motion-reduce:transition-none">
								<aside
									aria-label="Mail navigation"
									className="min-h-0 overflow-y-auto overscroll-contain px-3 py-4 [scrollbar-gutter:stable]"
								>
									<DashboardNav />
								</aside>
								<div className="flex min-h-0 min-w-0 flex-col">
									<header className="flex h-16 w-full shrink-0 items-center gap-2 pr-2 text-sm sm:gap-4 sm:pr-4">
										<MailSearchInput />
										<AppHeaderActions />
									</header>
									<MfaPolicyNotice />
									<main
										id="main-content"
										tabIndex={-1}
										className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain scrollbar-gutter-stable"
									>
										{children}
									</main>
								</div>
								<FloatingComposer />
							</div>
						</MailSearchProvider>
					</ComposeProvider>
				</MailboxProvider>
			</SidebarProvider>
		</AuthGuard>
	);
}
