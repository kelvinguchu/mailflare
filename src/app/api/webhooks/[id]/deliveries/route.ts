import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { listWebhookDeliveriesForUser } from "@/lib/email/webhooks";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
	const env = getEnv();
	const user = await requireUser(env, request);
	const { id } = await context.params;
	const deliveries = await listWebhookDeliveriesForUser(env, user.id, id);
	return NextResponse.json({ deliveries });
}
