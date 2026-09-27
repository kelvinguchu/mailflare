"use client";

import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { MessageFolderPage } from "./message-folder-page";
import { ReadingContext, type ReadingList } from "./reading-context";
import type { MessageSplitLayoutProps } from "./types";

/**
 * An open message takes the whole content area, like Gmail. The list stays mounted but hidden,
 * so going back keeps its page, scroll position, search, and selection.
 */
export function MessageSplitLayout({ children, config }: MessageSplitLayoutProps) {
	const pathname = usePathname();
	const [list, setList] = useState<ReadingList | null>(null);
	const detailPrefix = `${config.hrefPrefix}/`;
	const reading = pathname.startsWith(detailPrefix);
	const context = useMemo(
		() => ({ hrefPrefix: config.hrefPrefix, list }),
		[config.hrefPrefix, list],
	);

	return (
		<ReadingContext.Provider value={context}>
			<div className={cn("h-full min-h-0", reading && "hidden")}>
				<MessageFolderPage config={config} onVisibleMessagesChange={setList} />
			</div>
			{reading && (
				<section className="h-full min-h-0 min-w-0 overflow-hidden bg-white" aria-label="Message">
					{children}
				</section>
			)}
		</ReadingContext.Provider>
	);
}
