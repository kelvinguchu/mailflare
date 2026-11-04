import { consumeSentDraft } from "@/lib/team-inboxes/consume-draft";
import { getEnv } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/cookies";
import { readJsonBody } from "@/lib/http/request";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const env = getEnv(),
		user = await getCurrentUser(env, request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
	const { id } = await params;
	let messageId: unknown;
	try {
		({ messageId } = await readJsonBody<{ messageId?: unknown }>(request, 4096));
	} catch {
		return Response.json({ error: "Invalid request" }, { status: 400 });
	}
	if (typeof messageId !== "string")
		return Response.json({ error: "Message is required" }, { status: 400 });
	const consumed = await consumeSentDraft(env, user.id, id, messageId);
	return Response.json(
		{ ok: consumed },
		{ status: consumed ? 200 : 409, headers: { "Cache-Control": "private, no-store" } },
	);
}
