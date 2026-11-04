import type { AttachmentContent } from "@/lib/email/attachment-types";
import { readFormDataBody, readJsonBody } from "@/lib/http/request";
import type { SendRequestPayload } from "./types";
import { sendEmailSchema } from "@/lib/validators";
import { decodeBase64Content, validateAttachments } from "@/lib/email/attachments";
import {
	attachmentLimitError,
	MAX_ATTACHMENT_COUNT,
	MAX_SEND_REQUEST_SIZE,
	SendLimitError,
} from "@/lib/email/limits";

function getOptionalFormValue(form: FormData, key: string): string | undefined {
	const value = form.get(key);
	return typeof value === "string" && value ? value : undefined;
}

function getOptionalBooleanFormValue(form: FormData, key: string): boolean | undefined {
	const value = form.get(key);
	if (value === null || value === "") return undefined;
	if (value === "true") return true;
	if (value === "false") return false;
	throw new Error(`${key} must be true or false`);
}

export async function parseSendRequest(request: Request): Promise<SendRequestPayload> {
	if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
		const json = await readJsonBody<unknown>(request, MAX_SEND_REQUEST_SIZE);
		const parsed = sendEmailSchema.parse(json);
		const { attachments, ...fields } = parsed;
		const files = attachments?.map((attachment) => ({
			filename: attachment.filename,
			type: attachment.type,
			content: decodeBase64Content(attachment.contentBase64),
			disposition: "attachment" as const,
		}));
		if (files) validateAttachments(files);
		return { ...fields, attachments: files };
	}

	const form = await readFormDataBody(request, MAX_SEND_REQUEST_SIZE);
	const files = form.getAll("attachments").filter((value): value is File => value instanceof File);
	const limitError = attachmentLimitError(files);
	if (limitError)
		throw new SendLimitError(
			limitError,
			files.length > MAX_ATTACHMENT_COUNT ? "E_TOO_MANY_ATTACHMENTS" : "E_CONTENT_TOO_LARGE",
			files.length > MAX_ATTACHMENT_COUNT ? 400 : 413,
		);
	const attachments: AttachmentContent[] = [];
	for (const value of files) {
		attachments.push({
			filename: value.name,
			type: value.type || "application/octet-stream",
			content: await value.arrayBuffer(),
			disposition: "attachment",
		});
	}

	return {
		from: String(form.get("from") ?? ""),
		to: String(form.get("to") ?? ""),
		cc: getOptionalFormValue(form, "cc"),
		subject: String(form.get("subject") ?? ""),
		text: getOptionalFormValue(form, "text"),
		html: getOptionalFormValue(form, "html"),
		includeSignature: getOptionalBooleanFormValue(form, "includeSignature"),
		mailboxId: getOptionalFormValue(form, "mailboxId"),
		replyToMessageId: getOptionalFormValue(form, "replyToMessageId"),
		forwardMessageId: getOptionalFormValue(form, "forwardMessageId"),
		attachments,
	};
}
