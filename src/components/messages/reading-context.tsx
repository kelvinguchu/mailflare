"use client";

import { createContext, useContext } from "react";

/** The list a message was opened from, so the reading view can step through it. */
export type ReadingList = {
	ids: string[];
	/** Zero-based position of `ids[0]` within the whole folder. */
	offset: number;
	total: number;
};

export type ReadingContextValue = {
	hrefPrefix: string;
	list: ReadingList | null;
};

export const ReadingContext = createContext<ReadingContextValue | null>(null);

export type ReadingPosition = {
	backHref: string;
	/** One-based position in the folder, or null when the message is not on the loaded page. */
	position: number | null;
	total: number;
	previousHref: string | null;
	nextHref: string | null;
};

export function getReadingPosition(
	value: ReadingContextValue,
	messageIds: string[],
): ReadingPosition {
	const { hrefPrefix, list } = value;
	const index = list ? list.ids.findIndex((id) => messageIds.includes(id)) : -1;
	const hrefFor = (id: string | undefined) => (id ? `${hrefPrefix}/${id}` : null);
	if (!list || index < 0) {
		return { backHref: hrefPrefix, position: null, total: 0, previousHref: null, nextHref: null };
	}
	return {
		backHref: hrefPrefix,
		position: list.offset + index + 1,
		total: Math.max(list.total, list.offset + list.ids.length),
		previousHref: hrefFor(list.ids[index - 1]),
		nextHref: hrefFor(list.ids[index + 1]),
	};
}

/** Null outside a folder layout, e.g. when a message is opened from a direct link elsewhere. */
export function useReadingPosition(messageIds: string[]): ReadingPosition | null {
	const value = useContext(ReadingContext);
	return value ? getReadingPosition(value, messageIds) : null;
}
