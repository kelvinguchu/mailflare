import type { ReactNode } from "react";
import { SettingsNav } from "@/components/settings/settings-nav";

export default function SettingsLayout({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-[calc(100dvh-4rem)] flex-col gap-4 bg-inherit lg:flex-row">
			<div className="min-w-0 flex-1 px-3 pb-6 sm:px-4 lg:px-0 lg:pt-4">
				<div className="mx-auto w-full max-w-3xl">{children}</div>
			</div>
			<SettingsNav />
		</div>
	);
}
