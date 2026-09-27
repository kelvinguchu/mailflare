"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { primeMessageDetail } from "@/lib/messages/detail-cache";
import type { Message } from "@/hooks/types";
import type { MessageNavigationState } from "./message-navigation-types";

/** Opens a message straight away from the cached row; the reading view loads the rest in place. */
export function useMessageNavigation(href: string, message: Message): MessageNavigationState {
	const router = useRouter();

	function onNavigate(event: MouseEvent<HTMLAnchorElement>, markRead = false) {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		primeMessageDetail({ ...message, read: markRead || message.read });
		router.push(href);
	}

	return { onNavigate };
}
