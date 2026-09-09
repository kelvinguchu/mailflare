import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { redeliverWebhookForUser } from "@/lib/email/webhooks";

type RouteContext = { params: Promise<{ id: string; deliveryId: string }> };

export async function POST(request: Request, context: RouteContext) {
	const env = getEnv();
	const user = await requireUser(env, request);
	const { id, deliveryId } = await context.params;
	try {
		const queued = await redeliverWebhookForUser(env, user.id, id, deliveryId);
		if (!queued) return NextResponse.json({ error: "Delivery not found" }, { status: 404 });
		return NextResponse.json({ queued: true, deliveryId }, { status: 202 });
	} catch {
		return NextResponse.json({ error: "Webhook redelivery could not be queued" }, { status: 503 });
	}
}
