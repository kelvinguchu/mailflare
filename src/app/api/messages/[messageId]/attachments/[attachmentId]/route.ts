import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { serveAuthorizedAttachment } from "@/lib/email/attachment-response";
import type { AttachmentRouteParams } from "./types";

export async function GET(request: Request, context: AttachmentRouteParams) {
	return serveAttachment(request, context, false);
}
export async function HEAD(request: Request, context: AttachmentRouteParams) {
	return serveAttachment(request, context, true);
}
async function serveAttachment(request: Request, { params }: AttachmentRouteParams, head: boolean) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return new Response("Unauthorized", { status: 401 });
	const { messageId, attachmentId } = await params;
	return serveAuthorizedAttachment(env, user, request, messageId, attachmentId, head);
}
