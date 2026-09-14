"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { primeMessageDetail } from "@/lib/messages/detail-cache";
import type { Message } from "@/hooks/types";
import type { MessageNavigationState } from "./message-navigation-types";

export function useMessageNavigation(href: string, message: Message): MessageNavigationState {
	const pathname = usePathname();
	const router = useRouter();
	const [progress, setProgress] = useState<number | null>(null);
	const navigationPending = useRef(false);

	useEffect(() => {
		if (!navigationPending.current) return;
		setProgress(100);
		const timer = window.setTimeout(() => {
			navigationPending.current = false;
			setProgress(null);
		}, 220);
		return () => window.clearTimeout(timer);
	}, [pathname]);

	function onNavigate(event: MouseEvent<HTMLAnchorElement>, markRead = false) {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		primeMessageDetail({ ...message, read: markRead || message.read });
		navigationPending.current = true;
		setProgress(12);
		try {
			router.push(href);
		} catch {
			navigationPending.current = false;
			setProgress(null);
		}
	}

	return { progress, onNavigate };
}

export function MessageNavigationProgress({ progress }: { progress: number | null }) {
	if (progress === null) return null;
	return (
		<div className="fixed inset-x-0 top-0 z-[120] h-1 bg-primary/12">
			<div
				className="h-full bg-primary transition-[width] duration-100 ease-out"
				style={{ width: `${progress}%` }}
			/>
		</div>
	);
}
