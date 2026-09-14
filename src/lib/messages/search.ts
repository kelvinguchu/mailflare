export function getContainsPattern(value: string): string {
	const escaped = value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
	return `%${escaped}%`;
}
