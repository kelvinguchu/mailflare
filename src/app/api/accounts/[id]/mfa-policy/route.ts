import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin } from "@/app/api/accounts/utils";
import { selectAccountById } from "@/app/api/accounts/[id]/utils";
import type { AccountRouteParams } from "@/app/api/accounts/[id]/types";
import { requireRecentAuthentication } from "@/lib/auth/recent";
import { getMfaPolicy, isUserCoveredByMfaPolicy } from "@/lib/auth/mfa-policy";
import { createAuditLog } from "@/lib/mailboxes/audit";
import { mfaPolicyExceptionSchema } from "@/lib/validators";

const MAX_EXCEPTION_MS = 30 * 86_400_000;

export async function PATCH(request: Request, { params }: AccountRouteParams) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	const recentAuthError = await requireRecentAuthentication(access.env, access.user!.id);
	if (recentAuthError) return recentAuthError;
	const { id } = await params;
	if (id === access.user!.id) {
		return NextResponse.json({ error: "Administrators cannot exempt themselves" }, { status: 409 });
	}
	const account = await selectAccountById(getDb(access.env), id);
	if (!account || account.createdByUserId !== access.user!.id) {
		return NextResponse.json({ error: "Account not found" }, { status: 404 });
	}
	const parsed = mfaPolicyExceptionSchema.safeParse(await request.json());
	if (!parsed.success)
		return NextResponse.json({ error: "Invalid policy exception" }, { status: 400 });
	const exemptUntil = new Date(parsed.data.exemptUntil);
	const now = new Date();
	if (
		exemptUntil.getTime() <= now.getTime() ||
		exemptUntil.getTime() > now.getTime() + MAX_EXCEPTION_MS
	) {
		return NextResponse.json(
			{ error: "Exception expiry must be within the next 30 days" },
			{ status: 400 },
		);
	}
	const policy = await getMfaPolicy(access.env);
	if (!isUserCoveredByMfaPolicy(account, policy.mode)) {
		return NextResponse.json(
			{ error: "This account is not covered by the current policy" },
			{ status: 409 },
		);
	}
	await getDb(access.env)
		.update(users)
		.set({
			mfaPolicyExemptUntil: exemptUntil,
			mfaPolicyExemptionReason: parsed.data.reason,
			mfaPolicyExemptedByUserId: access.user!.id,
		})
		.where(and(eq(users.id, id), eq(users.activationStatus, "active")));
	await createAuditLog(access.env, {
		actorUserId: access.user!.id,
		targetUserId: id,
		action: "auth.mfa_policy_exception_granted",
		metadata: { exemptUntil: exemptUntil.toISOString(), reason: parsed.data.reason },
	});
	return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: AccountRouteParams) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	const recentAuthError = await requireRecentAuthentication(access.env, access.user!.id);
	if (recentAuthError) return recentAuthError;
	const { id } = await params;
	const account = await selectAccountById(getDb(access.env), id);
	if (!account || (account.id !== access.user!.id && account.createdByUserId !== access.user!.id)) {
		return NextResponse.json({ error: "Account not found" }, { status: 404 });
	}
	await getDb(access.env)
		.update(users)
		.set({
			mfaPolicyExemptUntil: null,
			mfaPolicyExemptionReason: null,
			mfaPolicyExemptedByUserId: null,
		})
		.where(eq(users.id, id));
	await createAuditLog(access.env, {
		actorUserId: access.user!.id,
		targetUserId: id,
		action: "auth.mfa_policy_exception_revoked",
	});
	return NextResponse.json({ ok: true });
}
