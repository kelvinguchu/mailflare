import type {
	PreviousMessageDirection,
	ReplyContentParts,
	QuotedEmailContent,
	SplitReplyContentOptions,
} from "./reply-content-types";
import { normalizeEmailAddress } from "./address";

const ORIGINAL_MESSAGE_RE = /^-{2,}\s*Original Message\s*-{2,}$/i;
const UNDERSCORE_SEPARATOR_RE = /^_{8,}$/;
const WROTE_RE = /^On\s+(.+?)\s+wrote:\s*$/i;
/** Quote headers without a date, such as `alex@example.com wrote:`. */
const ADDRESS_WROTE_RE = /^(?:.{0,80}?<)?\S+@\S+?>?\s+wrote:\s*$/i;
/** Mail clients wrap long `On …, Name <address> wrote:` headers over up to three lines. */
const MAX_WROTE_HEADER_LINES = 3;
const HEADER_RE = /^(From|To|Cc|Subject|Date|Sent):\s*(.*)$/i;

export function splitRepliedEmailContent(
	content: string | null | undefined,
	options: SplitReplyContentOptions = {},
): ReplyContentParts {
	const lines = normalizeContent(content).split("\n");
	const originalMessageIndex = lines.findIndex((line) => ORIGINAL_MESSAGE_RE.test(line.trim()));
	if (originalMessageIndex >= 0) {
		return splitOriginalMessage(lines, originalMessageIndex, options);
	}

	const underscoreSeparatorIndex = lines.findIndex((line) =>
		UNDERSCORE_SEPARATOR_RE.test(line.trim()),
	);
	if (underscoreSeparatorIndex >= 0) {
		return splitSeparatorQuotedContent(lines, underscoreSeparatorIndex, options);
	}

	const wrote = findWroteHeader(lines);
	if (wrote) {
		const { index: wroteIndex, end: wroteEnd, markerLine } = wrote;
		const quotedLines = stripSingleQuotePrefix(lines.slice(wroteEnd + 1));
		return {
			latestContent: trimEmptyLines(lines.slice(0, wroteIndex)).join("\n").trim(),
			quotedContent: buildQuotedContent(
				quotedLines,
				getWroteDateLine(markerLine),
				getPreviousMessageDirection(getWroteAddress(markerLine), options.ownAddress),
				options,
			),
		};
	}

	const quoteIndex = lines.findIndex((line) => line.trim().startsWith(">"));
	if (quoteIndex >= 0) {
		const quotedLines = stripSingleQuotePrefix(lines.slice(quoteIndex));
		return {
			latestContent: trimEmptyLines(lines.slice(0, quoteIndex)).join("\n").trim(),
			quotedContent: buildQuotedContent(quotedLines, "Unknown time", "received", options),
		};
	}

	return { latestContent: normalizeContent(content).trim(), quotedContent: [] };
}

export function getLatestEmailContent(content: string | null | undefined): string {
	return splitRepliedEmailContent(content).latestContent;
}

export function htmlToReadableText(html: string | null | undefined): string {
	return (html ?? "")
		.replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li|tr|blockquote|h[1-6])>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

function splitOriginalMessage(
	lines: string[],
	markerIndex: number,
	options: SplitReplyContentOptions,
): ReplyContentParts {
	const latestContent = trimEmptyLines(lines.slice(0, markerIndex)).join("\n").trim();
	const quotedLines = lines.slice(markerIndex + 1);
	const headers = new Map<string, string>();
	let contentStartIndex = 0;

	for (let index = 0; index < quotedLines.length; index += 1) {
		const line = quotedLines[index] ?? "";
		if (!line.trim()) {
			contentStartIndex = index + 1;
			break;
		}

		const match = line.match(HEADER_RE);
		if (match) {
			headers.set(match[1].toLowerCase(), match[2].trim());
			contentStartIndex = index + 1;
		}
	}

	const quotedContent = buildQuotedContent(
		stripSingleQuotePrefix(quotedLines.slice(contentStartIndex)),
		headers.get("date") ?? headers.get("sent") ?? "Unknown time",
		getPreviousMessageDirection(headers.get("from"), options.ownAddress),
		options,
	);

	return { latestContent, quotedContent };
}

function splitSeparatorQuotedContent(
	lines: string[],
	separatorIndex: number,
	options: SplitReplyContentOptions,
): ReplyContentParts {
	const quotedLines = trimEmptyLines(lines.slice(separatorIndex + 1));
	return {
		latestContent: trimEmptyLines(lines.slice(0, separatorIndex)).join("\n").trim(),
		quotedContent: buildQuotedContent(
			quotedLines,
			getHeaderValue(quotedLines, "sent") ?? getHeaderValue(quotedLines, "date") ?? "Unknown time",
			getPreviousMessageDirection(getHeaderValue(quotedLines, "from"), options.ownAddress),
			options,
		),
	};
}

/** Finds a quote header that may be wrapped across several lines. */
function findWroteHeader(
	lines: string[],
): { index: number; end: number; markerLine: string } | null {
	for (let index = 0; index < lines.length; index += 1) {
		const first = lines[index]?.trim() ?? "";
		if (!first) continue;
		if (ADDRESS_WROTE_RE.test(first)) return { index, end: index, markerLine: first };
		if (!/^On\s/i.test(first)) continue;
		let joined = first;
		const last = Math.min(lines.length, index + MAX_WROTE_HEADER_LINES);
		for (let end = index; end < last; end += 1) {
			if (end > index) joined = `${joined} ${lines[end]?.trim() ?? ""}`.trim();
			if (WROTE_RE.test(joined)) return { index, end, markerLine: joined };
		}
	}
	return null;
}

const PREVIEW_CUT_PATTERNS = [
	/\s*\bOn\s+(?:[A-Z][a-z]{2,8}\.?,?\s+)?(?:\d{1,2}\s+[A-Z][a-z]{2,9}\.?,?\s+\d{4}|[A-Z][a-z]{2,9}\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/,
	/\s*\bOn\s.{0,160}?\bwrote:/i,
	/\s*(?:"[^"]{1,80}"\s*)?<?\S+@\S+?>?\s+wrote:/i,
	/\s*-{2,}\s*(?:Original|Forwarded) Message/i,
	/\s+>\s/,
];

/**
 * A single-line preview of a message without quoted history, for list rows and collapsed
 * conversation messages. Also handles snippets whose line breaks were already flattened.
 */
export function getMessagePreviewText(content: string | null | undefined): string {
	const latest = splitRepliedEmailContent(content).latestContent.replace(/\s+/g, " ").trim();
	let end = latest.length;
	for (const pattern of PREVIEW_CUT_PATTERNS) {
		const match = pattern.exec(latest);
		if (match && match.index > 0 && match.index < end) end = match.index;
	}
	return latest.slice(0, end).trim();
}

function getWroteDateLine(line: string): string {
	const match = line.match(WROTE_RE);
	const rawDateLine = match?.[1]?.trim() ?? "";
	const withoutAddress = rawDateLine.replace(/\s*<[^>]+>\s*$/, "");
	// The sender name follows the time, e.g. `Tue, 15 Sept 2026, 19:05 Alex Doe`.
	const throughTime = /^(.*?\b\d{1,2}:\d{2}(?:\s?[AP]M)?)(?=\W|$)/i.exec(withoutAddress)?.[1];
	return (
		(throughTime ?? withoutAddress.replace(/,\s*["']?[^,\d]+["']?,?$/, "")).trim() || "Unknown time"
	);
}

function getWroteAddress(line: string): string | undefined {
	return line.match(/<([^>]+@[^>]+)>/)?.[1] ?? line.match(/(\S+@[^\s>]+)\s+wrote:/i)?.[1];
}

function normalizeContent(content: string | null | undefined): string {
	return (content ?? "").replace(/\r\n?/g, "\n");
}

function stripSingleQuotePrefix(lines: string[]): string[] {
	return trimEmptyLines(lines.map((line) => line.replace(/^\s*>\s?/, "")));
}

function trimEmptyLines(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;

	while (start < end && !lines[start]?.trim()) start += 1;
	while (end > start && !lines[end - 1]?.trim()) end -= 1;

	return lines.slice(start, end);
}

function hasQuotedContent(quotedContent: QuotedEmailContent): boolean {
	return quotedContent.content.trim().length > 0 || quotedContent.quotedContent.length > 0;
}

function buildQuotedContent(
	lines: string[],
	dateLine: string,
	direction: PreviousMessageDirection,
	options: SplitReplyContentOptions,
): QuotedEmailContent[] {
	const rawContent = trimEmptyLines(lines).join("\n").trim();
	if (!rawContent) return [];

	const nested = splitRepliedEmailContent(rawContent, options);
	const quotedContent: QuotedEmailContent = {
		dateLine,
		direction,
		content: nested.latestContent,
		quotedContent: nested.quotedContent,
	};

	return hasQuotedContent(quotedContent) ? [quotedContent] : [];
}

function getPreviousMessageDirection(
	from: string | undefined,
	ownAddress: string | undefined,
): PreviousMessageDirection {
	if (!from || !ownAddress) return "received";
	const fromAddress = normalizeEmailAddress(from.match(/<([^>]+)>/)?.[1] ?? from);
	return fromAddress === normalizeEmailAddress(ownAddress) ? "sent" : "received";
}

function getHeaderValue(lines: string[], name: string): string | undefined {
	for (const line of lines) {
		const match = line.match(HEADER_RE);
		if (match?.[1].toLowerCase() === name) return match[2].trim();
	}
	return undefined;
}
