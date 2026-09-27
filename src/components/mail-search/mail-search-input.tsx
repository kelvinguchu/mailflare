"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useMailSearch } from "./mail-search-context";

export function MailSearchInput() {
	const { query, setQuery } = useMailSearch();

	return (
		<div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full bg-[#eaf1fb] px-3 text-neutral-600 transition-[background-color,box-shadow] focus-within:bg-white focus-within:shadow-[0_1px_3px_rgb(60_64_67/0.3)] sm:gap-3 sm:px-4">
			<Search aria-hidden="true" className="h-5 w-5 shrink-0" />
			<Input
				type="search"
				name="mail-search"
				aria-label="Search mail"
				autoComplete="off"
				spellCheck={false}
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder="Search mail…"
				className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-neutral-800 outline-none! shadow-none! border-none! placeholder:text-neutral-500"
			/>
			{query && (
				<button
					type="button"
					onClick={() => setQuery("")}
					className="rounded-full p-1 text-neutral-500 hover:bg-primary/15 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-primary/40"
					aria-label="Clear search"
				>
					<X aria-hidden="true" className="h-4 w-4" />
				</button>
			)}
		</div>
	);
}
