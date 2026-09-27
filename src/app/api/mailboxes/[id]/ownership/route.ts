import { z } from "zod";
import { NextResponse } from "next/server";
import { transferMailboxOwnership, AccountLifecycleError } from "@/lib/accounts/lifecycle";
import { requireRecentAuthentication } from "@/lib/auth/recent";
import { mailboxOwnershipTransferSchema } from "@/lib/validators";
import { requireAdmin } from "@/app/api/accounts/utils";

type MailboxRouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: MailboxRouteParams) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	const recentAuthError = await requireRecentAuthentication(access.env, access.user!.id);
	if (recentAuthError) return recentAuthError;
	const parsed = mailboxOwnershipTransferSchema.safeParse(await request.json());
	if (!parsed.success) {
		return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
	}
	const { id } = await params;
	try {
		await transferMailboxOwnership(access.env, {
			mailboxId: id,
			newOwnerUserId: parsed.data.newOwnerUserId,
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
