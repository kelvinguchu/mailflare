import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { requireUser } from "@/lib/auth/cookies";
import { getDomainForUser, removeDomainForUser } from "@/lib/domains/service";
import { updateDomainLimitsSchema } from "@/lib/validators";
import { getDb } from "@/db";
import { domains } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createAuditLog } from "@/lib/mailboxes/audit";
import { requireRecentAuthentication } from "@/lib/auth/recent";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	const domain = await getDomainForUser(env, user.id, id);
	if (!domain) return NextResponse.json({ error: "Not found" }, { status: 404 });
	return NextResponse.json({ domain });
}

export async function PATCH(request: Request, { params }: Params) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	const recentAuthError = await requireRecentAuthentication(env, user.id);
	if (recentAuthError) return recentAuthError;
	const domain = await getDomainForUser(env, user.id, id);
	if (!domain) return NextResponse.json({ error: "Not found" }, { status: 404 });
	const parsed = updateDomainLimitsSchema.safeParse(await request.json());
	if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
	await getDb(env).update(domains).set(parsed.data).where(eq(domains.id, id));
	await createAuditLog(env, {
		actorUserId: user.id,
		action: "domain.send_limits_updated",
		metadata: {
			domainId: id,
			from: { perMinute: domain.sendRateLimitPerMinute, daily: domain.dailySendLimit },
			to: { perMinute: parsed.data.sendRateLimitPerMinute, daily: parsed.data.dailySendLimit },
		},
	});
	return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: Params) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	try {
		await removeDomainForUser(env, user.id, id);
		return NextResponse.json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to remove domain";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
