import { z } from "zod";
import { MESSAGE_CURSOR_MAX_LENGTH } from "./pagination";

export const MESSAGE_SEARCH_LIMITS = {
	queryLength: 200,
	addressLength: 320,
	resultLimit: 100,
	offset: 10_000,
} as const;

const optionalQuery = z.preprocess(
	(value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
	z
		.string()
		.trim()
		.min(3, "Search terms must contain at least 3 characters")
		.max(MESSAGE_SEARCH_LIMITS.queryLength)
		.optional(),
);

const optionalAddress = z.preprocess(
	(value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
	z
		.string()
		.trim()
		.min(3, "Address filters must contain at least 3 characters")
		.max(MESSAGE_SEARCH_LIMITS.addressLength)
		.optional(),
);

const optionalDate = z.preprocess(
	(value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
	z.union([z.iso.date(), z.iso.datetime({ offset: true })]).optional(),
);

const integerString = (minimum: number, maximum: number) =>
	z
		.string()
		.regex(/^\d+$/, "Must be a whole number")
		.transform(Number)
		.pipe(z.number().int().min(minimum).max(maximum));

const messageSearchParamsSchema = z.object({
	q: optionalQuery,
	title: optionalQuery,
	from: optionalAddress,
	to: optionalAddress,
	hasAttachments: z
		.enum(["true", "false"])
		.transform((value) => value === "true")
		.optional(),
	after: optionalDate,
	before: optionalDate,
	limit: integerString(1, MESSAGE_SEARCH_LIMITS.resultLimit).optional().default(50),
	offset: integerString(0, MESSAGE_SEARCH_LIMITS.offset).optional().default(0),
	pagination: z.enum(["offset", "cursor"]).optional().default("offset"),
	cursor: z.string().min(1).max(MESSAGE_CURSOR_MAX_LENGTH).optional(),
});

export type MessageSearchFilters = {
	query?: string;
	title?: string;
	sender?: string;
	recipient?: string;
	hasAttachments?: boolean;
	after?: Date;
	before?: Date;
	limit: number;
	offset: number;
	pagination: "offset" | "cursor";
	cursor?: string;
};

export class MessageSearchValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MessageSearchValidationError";
	}
}

const CONTROLLED_PARAMETERS = [
	"q",
	"title",
	"from",
	"to",
	"hasAttachments",
	"after",
	"before",
	"limit",
	"offset",
	"pagination",
	"cursor",
] as const;

export function parseMessageSearchParams(params: URLSearchParams): MessageSearchFilters {
	for (const parameter of CONTROLLED_PARAMETERS) {
		if (params.getAll(parameter).length > 1) {
			throw new MessageSearchValidationError(`Parameter "${parameter}" may only be provided once`);
		}
	}

	const parsed = messageSearchParamsSchema.safeParse({
		q: params.get("q") ?? undefined,
		title: params.get("title") ?? undefined,
		from: params.get("from") ?? undefined,
		to: params.get("to") ?? undefined,
		hasAttachments: params.get("hasAttachments") ?? undefined,
		after: params.get("after") ?? undefined,
		before: params.get("before") ?? undefined,
		limit: params.get("limit") ?? undefined,
		offset: params.get("offset") ?? undefined,
		pagination: params.get("pagination") ?? undefined,
		cursor: params.get("cursor") ?? undefined,
	});

	if (!parsed.success) {
		throw new MessageSearchValidationError(
			parsed.error.issues[0]?.message ?? "Invalid search query",
		);
	}

	const after = parsed.data.after ? parseDateBoundary(parsed.data.after, false) : undefined;
	const before = parsed.data.before ? parseDateBoundary(parsed.data.before, true) : undefined;
	if (after && before && after > before) {
		throw new MessageSearchValidationError("The after date must not be later than the before date");
	}
	if (parsed.data.cursor && parsed.data.pagination !== "cursor") {
		throw new MessageSearchValidationError('The cursor parameter requires pagination="cursor"');
	}
	if (parsed.data.pagination === "cursor" && parsed.data.offset !== 0) {
		throw new MessageSearchValidationError("Cursor pagination cannot be combined with an offset");
	}

	return {
		query: parsed.data.q,
		title: parsed.data.title,
		sender: parsed.data.from,
		recipient: parsed.data.to,
		hasAttachments: parsed.data.hasAttachments,
		after,
		before,
		limit: parsed.data.limit,
		offset: parsed.data.offset,
		pagination: parsed.data.pagination,
		cursor: parsed.data.cursor,
	};
}

export function buildFtsPhrase(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

export function buildScopedFtsPhrase(
	column: "sender" | "recipients" | "subject",
	value: string,
): string {
	return `${column} : ${buildFtsPhrase(value)}`;
}

function parseDateBoundary(value: string, endOfDay: boolean): Date {
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
	}
	return new Date(value);
}
