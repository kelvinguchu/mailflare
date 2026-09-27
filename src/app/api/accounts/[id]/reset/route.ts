import { z } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireRecentAuthentication } from "@/lib/auth/recent";
import { deliverAuthEmail } from "@/lib/auth/recovery";
import { getExecutionContext } from "@/lib/cloudflare";
import { AccountLifecycleError, resetAccountForInvitation } from "@/lib/accounts/lifecycle";
import { accountResetSchema } from "@/lib/validators";
import { requireAdmin } from "@/app/api/accounts/utils";
import type { AccountRouteParams } from "@/app/api/accounts/[id]/types";
import { selectAccountById } from "@/app/api/accounts/[id]/utils";

export async function POST(request: Request, { params }: AccountRouteParams) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	const recentAuthError = await requireRecentAuthentication(access.env, access.user!.id);
	if (recentAuthError) return recentAuthError;
	const { id } = await params;
	const account = await selectAccountById(getDb(access.env), id);
	if (!account || account.createdByUserId !== access.user!.id) {
		return NextResponse.json({ error: "Account not found" }, { status: 404 });
	}
	const parsed = accountResetSchema.safeParse(await request.json());
	if (!parsed.success) {
		return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
	}
	try {
		const result = await resetAccountForInvitation(access.env, {
			accountId: id,
			actorUserId: access.user!.id,
			invitationEmail: parsed.data.invitationEmail,
			confirmation: parsed.data.confirmation,
		});
		if (result.invitation.status === "pending") {
			getExecutionContext().waitUntil(deliverAuthEmail(access.env, result.invitation.email));
		}
		return NextResponse.json({ ok: true, invitationDelivery: result.invitation.status });
	} catch (error) {
		if (error instanceof AccountLifecycleError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}
