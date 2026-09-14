// `cn` now comes from the `cn` package installed by the shadcn preset; the
// helpers below predate it and are used across the mail and routing code.
export { cn } from "cn";

export function slugify(value: string): string {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function parseAddress(address: string): { local: string; domain: string } | null {
	const normalized = address.trim().match(/<([^>]+)>$/)?.[1] ?? address.trim();
	const match = normalized.match(/^([^@\s]+)@([^@\s]+)$/);
	if (!match) return null;
	return { local: match[1].toLowerCase(), domain: match[2].toLowerCase() };
}
