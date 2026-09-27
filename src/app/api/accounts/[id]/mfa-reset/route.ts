import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin } from "@/app/api/accounts/utils";
import { selectAccountById } from "@/app/api/accounts/[id]/utils";
import type { AccountRouteParams } from "@/app/api/accounts/[id]/types";
import { isMfaEnabled } from "@/lib/auth/mfa";
import { syncUserMfaPolicyCoverage } from "@/lib/auth/mfa-policy";
import { requireRecentAuthentication } from "@/lib/auth/recent";
import { revokeAllSessions } from "@/lib/auth/session";
import { createAuditLog } from "@/lib/mailboxes/audit";
import { mfaResetSchema } from "@/lib/validators";

export async function POST(request: Request, { params }: AccountRouteParams) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	const recentAuthError = await requireRecentAuthentication(access.env, access.user!.id);
	if (recentAuthError) return recentAuthError;
	if (!isMfaEnabled(access.user!)) {
		return NextResponse.json(
			{ error: "Enable MFA before resetting another account" },
			{ status: 409 },
		);
	}
	const { id } = await params;
	if (id === access.user!.id) {
		return NextResponse.json({ error: "You cannot reset your own MFA" }, { status: 409 });
	}
	const account = await selectAccountById(getDb(access.env), id);
	if (!account || account.createdByUserId !== access.user!.id) {
		return NextResponse.json({ error: "Account not found" }, { status: 404 });
	}
	if (account.disabled || account.archivedAt || account.activationStatus !== "active") {
		return NextResponse.json({ error: "Only active accounts can have MFA reset" }, { status: 409 });
	}
	if (!isMfaEnabled(account)) {
		return NextResponse.json(
			{ error: "Multi-factor authentication is not enabled" },
			{ status: 409 },
		);
	}
	const parsed = mfaResetSchema.safeParse(await request.json());
	if (!parsed.success || parsed.data.confirmation !== `reset mfa ${account.email}`) {
		return NextResponse.json(
			{ error: `Type “reset mfa ${account.email}” to confirm this action` },
			{ status: 400 },
		);
	}
	await getDb(access.env)
		.update(users)
		.set({
			mfaSecretEncrypted: null,
			mfaEnabledAt: null,
			mfaRecoveryCodeHashes: "[]",
			mfaLastUsedCounter: null,
			mfaPolicyCoveredAt: new Date(),
			mfaPolicyExemptUntil: null,
			mfaPolicyExemptionReason: null,
			mfaPolicyExemptedByUserId: null,
		})
		.where(eq(users.id, id));
	const revokedSessions = await revokeAllSessions(access.env, id);
	await syncUserMfaPolicyCoverage(access.env, id);
	await createAuditLog(access.env, {
		actorUserId: access.user!.id,
		targetUserId: id,
		action: "auth.mfa_reset_by_administrator",
		metadata: { revokedSessions },
	});
	return NextResponse.json({ ok: true, revokedSessions });
}
