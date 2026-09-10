import { NextResponse } from "next/server";
import { revokeAllSessions } from "@/lib/auth/session";
import { createAuditLog } from "@/lib/mailboxes/audit";
import { requireAdmin } from "../../utils";
import type { AccountRouteParams } from "../types";
import { selectAccountById } from "../utils";
import { getDb } from "@/db";
import { requireRecentAuthentication } from "@/lib/auth/recent";

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

	const revokedSessions = await revokeAllSessions(access.env, account.id);
	await createAuditLog(access.env, {
		actorUserId: access.user!.id,
		targetUserId: account.id,
		action: "auth.sessions_admin_revoked",
		metadata: { revokedSessions },
	});
	return NextResponse.json({ ok: true, revokedSessions });
}
