import { z } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import {
	AccountLifecycleError,
	archiveAccount,
	deleteArchivedAccount,
} from "@/lib/accounts/lifecycle";
import { requireRecentAuthentication } from "@/lib/auth/recent";
import { accountLifecycleSchema } from "@/lib/validators";
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
	const parsed = accountLifecycleSchema.safeParse(await request.json());
	if (!parsed.success) {
		return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
	}
	try {
		if (parsed.data.action === "archive") {
			const result = await archiveAccount(access.env, {
				accountId: id,
				actorUserId: access.user!.id,
				successorUserId: parsed.data.successorUserId,
				confirmation: parsed.data.confirmation,
			});
			return NextResponse.json({ ok: true, ...result });
		}
		await deleteArchivedAccount(access.env, {
			accountId: id,
			actorUserId: access.user!.id,
			confirmation: parsed.data.confirmation,
		});
		return NextResponse.json({ ok: true });
	} catch (error) {
		if (error instanceof AccountLifecycleError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}
