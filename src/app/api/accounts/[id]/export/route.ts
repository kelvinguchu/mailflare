import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { createAccountExport } from "@/lib/accounts/export";
import { requireRecentAuthentication } from "@/lib/auth/recent";
import { requireAdmin } from "@/app/api/accounts/utils";
import type { AccountRouteParams } from "@/app/api/accounts/[id]/types";
import { selectAccountById } from "@/app/api/accounts/[id]/utils";

function safeFilename(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function GET(request: Request, { params }: AccountRouteParams) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	const recentAuthError = await requireRecentAuthentication(access.env, access.user!.id);
	if (recentAuthError) return recentAuthError;
	const { id } = await params;
	const account = await selectAccountById(getDb(access.env), id);
	if (!account || account.createdByUserId !== access.user!.id) {
		return NextResponse.json({ error: "Account not found" }, { status: 404 });
	}
	const body = await createAccountExport(access.env, id);
	return new Response(body, {
		headers: {
			"Content-Type": "application/x-tar",
			"Content-Disposition": `attachment; filename="cc-mail-account-${safeFilename(account.email)}.tar"`,
			"Cache-Control": "private, no-store",
			"X-Content-Type-Options": "nosniff",
		},
	});
}
