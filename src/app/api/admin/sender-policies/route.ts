import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { senderPolicies } from "@/db/schema";
import { requireAdmin } from "@/app/api/accounts/utils";
import { requireRecentAuthentication } from "@/lib/auth/recent";
import { getEmailAddress } from "@/lib/email/address";
import { newId } from "@/lib/ids";
import { createAuditLog } from "@/lib/mailboxes/audit";
import { senderPolicySchema } from "@/lib/validators";

export async function GET(request: Request) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	const policies = await getDb(access.env).select().from(senderPolicies);
	return NextResponse.json({ policies });
}

export async function POST(request: Request) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	const recentAuthError = await requireRecentAuthentication(access.env, access.user!.id);
	if (recentAuthError) return recentAuthError;
	const parsed = senderPolicySchema.safeParse(await request.json());
	if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
	const pattern = normalizePattern(parsed.data.patternType, parsed.data.pattern);
	if (!pattern) return NextResponse.json({ error: "Invalid sender pattern" }, { status: 400 });
	const db = getDb(access.env);
	const scope = parsed.data.userId
		? eq(senderPolicies.userId, parsed.data.userId)
		: isNull(senderPolicies.userId);
	const [existing] = await db.select({ id: senderPolicies.id }).from(senderPolicies).where(and(
		scope,
		eq(senderPolicies.patternType, parsed.data.patternType),
		eq(senderPolicies.pattern, pattern),
	)).limit(1);
	const id = existing?.id ?? newId("policy");
	if (existing) {
		await db.update(senderPolicies).set({ action: parsed.data.action, createdByUserId: access.user!.id }).where(eq(senderPolicies.id, id));
	} else {
		await db.insert(senderPolicies).values({
			id,
			userId: parsed.data.userId ?? null,
			patternType: parsed.data.patternType,
			pattern,
			action: parsed.data.action,
			createdByUserId: access.user!.id,
		});
	}
	await createAuditLog(access.env, {
		actorUserId: access.user!.id,
		targetUserId: parsed.data.userId ?? null,
		action: "sender_policy.updated",
		metadata: { patternType: parsed.data.patternType, pattern, policyAction: parsed.data.action },
	});
	return NextResponse.json({ ok: true, id });
}

export async function DELETE(request: Request) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	const recentAuthError = await requireRecentAuthentication(access.env, access.user!.id);
	if (recentAuthError) return recentAuthError;
	const id = new URL(request.url).searchParams.get("id") ?? "";
	if (!id) return NextResponse.json({ error: "Policy ID is required" }, { status: 400 });
	const [policy] = await getDb(access.env).select().from(senderPolicies).where(eq(senderPolicies.id, id)).limit(1);
	if (!policy) return NextResponse.json({ error: "Not found" }, { status: 404 });
	await getDb(access.env).delete(senderPolicies).where(eq(senderPolicies.id, id));
	await createAuditLog(access.env, {
		actorUserId: access.user!.id,
		targetUserId: policy.userId,
		action: "sender_policy.deleted",
		metadata: { patternType: policy.patternType, pattern: policy.pattern },
	});
	return NextResponse.json({ ok: true });
}

function normalizePattern(type: "address" | "domain", value: string): string {
	const normalized = value.trim().toLowerCase().replace(/^@/, "");
	if (type === "address") return getEmailAddress(normalized).toLowerCase();
	return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized)
		? normalized
		: "";
}
