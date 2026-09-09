import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { deliverAuthEmail, prepareAccountActivation, revokeAccountInvitation } from "@/lib/auth/recovery";
import { getExecutionContext } from "@/lib/cloudflare";
import { accountInvitationSchema } from "@/lib/validators";
import { requireAdmin } from "../../utils";
import type { AccountRouteParams } from "../types";
import { selectAccountById } from "../utils";

export async function POST(request: Request, { params }: AccountRouteParams) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	const { id } = await params;
	const db = getDb(access.env);
	const account = await selectAccountById(db, id);
	if (!account || (account.id !== access.user!.id && account.createdByUserId !== access.user!.id)) {
		return NextResponse.json({ error: "Account not found" }, { status: 404 });
	}
	if (account.activationStatus === "active") {
		return NextResponse.json({ error: "This account is already active" }, { status: 409 });
	}
	const parsed = accountInvitationSchema.safeParse(await request.json());
	if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
	const invitationEmail = parsed.data.invitationEmail?.toLowerCase() ?? account.resetEmail;
	if (!invitationEmail) return NextResponse.json({ error: "An invitation email is required" }, { status: 400 });
	if (invitationEmail === account.email.toLowerCase()) {
		return NextResponse.json({ error: "Use an external email address for the invitation" }, { status: 400 });
	}
	if (account.activationStatus === "pending") {
		const revoked = await revokeAccountInvitation(access.env, id, access.user!.id);
		if (!revoked) {
			return NextResponse.json({ error: "This account was activated while the invitation was being updated" }, { status: 409 });
		}
	}
	const updated = await db.update(users).set({
		resetEmail: invitationEmail,
		resetEmailVerifiedAt: null,
		activationStatus: "pending",
	}).where(and(eq(users.id, id), ne(users.activationStatus, "active"))).returning({ id: users.id });
	if (updated.length === 0) {
		return NextResponse.json({ error: "This account is already active" }, { status: 409 });
	}
	const invitation = await prepareAccountActivation(access.env, id);
	if (invitation.status === "pending") {
		getExecutionContext().waitUntil(deliverAuthEmail(access.env, invitation.email));
	}
	return NextResponse.json({ ok: true, invitationDelivery: invitation.status });
}

export async function DELETE(request: Request, { params }: AccountRouteParams) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	const { id } = await params;
	const account = await selectAccountById(getDb(access.env), id);
	if (!account || (account.id !== access.user!.id && account.createdByUserId !== access.user!.id)) {
		return NextResponse.json({ error: "Account not found" }, { status: 404 });
	}
	if (account.activationStatus === "active") {
		return NextResponse.json({ error: "An active account has no invitation to revoke" }, { status: 409 });
	}
	if (account.activationStatus === "pending") {
		await revokeAccountInvitation(access.env, id, access.user!.id);
	}
	return NextResponse.json({ ok: true });
}
