export type MailSearchContextValue = {
	query: string;
	debouncedQuery: string;
	setQuery: (query: string) => void;
};
