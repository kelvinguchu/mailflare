"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { MailSearchContextValue } from "./types";

const MailSearchContext = createContext<MailSearchContextValue | null>(null);
const MAIL_SEARCH_DEBOUNCE_MS = 150;

export function useMailSearch() {
	const ctx = useContext(MailSearchContext);
	if (!ctx) throw new Error("useMailSearch must be used within MailSearchProvider");
	return ctx;
}

export function MailSearchProvider({ children }: { children: ReactNode }) {
	const [query, setQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");

	useEffect(() => {
		const timeout = window.setTimeout(
			() => setDebouncedQuery(query),
			query.trim() ? MAIL_SEARCH_DEBOUNCE_MS : 0,
		);
		return () => window.clearTimeout(timeout);
	}, [query]);

	return (
		<MailSearchContext.Provider value={{ query, debouncedQuery, setQuery }}>
			{children}
		</MailSearchContext.Provider>
	);
}
