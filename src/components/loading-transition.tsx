"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useBranding } from "@/components/branding-provider";
import type { LoadingTransitionProps } from "./loading-transition-types";

/**
 * Covers the app only until the protected-session decision is known. Once the shell is shown it
 * stays shown: route data, refetches, polling, and mutations present their own local progress.
 */
export function LoadingTransition({ children, ready }: LoadingTransitionProps) {
	const branding = useBranding();
	const [iconUrl, setIconUrl] = useState(branding.iconUrl);
	const [revealed, setRevealed] = useState(ready);

	useEffect(() => {
		if (ready) setRevealed(true);
	}, [ready]);

	useEffect(() => {
		setIconUrl(branding.iconUrl);
	}, [branding.iconUrl]);

	const showContent = ready || revealed;

	return (
		<div className="relative min-h-dvh bg-[#f6f8fc]">
			{showContent && <div className="min-h-dvh">{children}</div>}
			{!showContent && (
				<div
					role="status"
					aria-live="polite"
					data-slot="bootstrap-overlay"
					className="fixed inset-0 z-100 flex items-center justify-center bg-[#f6f8fc]"
				>
					<span className="sr-only">Loading {branding.appName}</span>
					<div className="flex w-64 flex-col items-center gap-6" aria-hidden="true">
						<Image
							src={iconUrl}
							onError={() => setIconUrl("/cc-mail-logo.png")}
							alt=""
							width={144}
							height={80}
							unoptimized
							className="h-20 w-36 object-contain"
						/>
						<div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/12">
							<div className="h-full w-2/5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
