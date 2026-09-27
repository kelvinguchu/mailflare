import { z } from "zod";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { mailboxes, users } from "@/db/schema";
import { updateManagedAccountSchema } from "@/lib/validators";
import { requireAdmin } from "../utils";
import { countActiveSessions } from "@/lib/auth/session";
import { requireRecentAuthentication } from "@/lib/auth/recent";
import type { AccountRouteParams } from "./types";
import { selectAccountById } from "./utils";
import { createAuditLog } from "@/lib/mailboxes/audit";
import { syncUserMfaPolicyCoverage } from "@/lib/auth/mfa-policy";

export async function GET(request: Request, { params }: AccountRouteParams) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	const { id } = await params;
	const account = await selectAccountById(getDb(access.env), id);
	if (!account || (account.id !== access.user!.id && account.createdByUserId !== access.user!.id)) {
		return NextResponse.json({ error: "Account not found" }, { status: 404 });
	}
	const activeSessionCount = await countActiveSessions(access.env, account.id);
	return NextResponse.json({
		account: {
			id: account.id,
			email: account.email,
			name: account.name,
			role: account.role,
			resetEmail: account.resetEmail,
			activationStatus: account.activationStatus,
			activatedAt: account.activatedAt,
			invitationSentAt: account.invitationSentAt,
			invitationExpiresAt: account.invitationExpiresAt,
			invitationExpired:
				account.activationStatus === "pending" &&
				!!account.invitationExpiresAt &&
				account.invitationExpiresAt.getTime() <= Date.now(),
			disabled: account.disabled,
			archivedAt: account.archivedAt,
			canManageMailboxes: account.canManageMailboxes,
			sendRateLimitPerMinute: account.sendRateLimitPerMinute,
			dailySendLimit: account.dailySendLimit,
			activeSessionCount,
			forwardingEmail: account.forwardingEmail,
			mfaEnabled: !!account.mfaEnabledAt,
			mfaPolicyCoveredAt: account.mfaPolicyCoveredAt,
			mfaPolicyExemptUntil: account.mfaPolicyExemptUntil,
			mfaPolicyExemptionReason: account.mfaPolicyExemptionReason,
			mfaPolicyExceptionActive:
				!!account.mfaPolicyExemptUntil && account.mfaPolicyExemptUntil.getTime() > Date.now(),
			hasAvatar: !!account.avatarKey,
		},
	});
}

export async function PATCH(request: Request, { params }: AccountRouteParams) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	const recentAuthError = await requireRecentAuthentication(access.env, access.user!.id);
	if (recentAuthError) return recentAuthError;
	const { id } = await params;
	const db = getDb(access.env);
	const account = await selectAccountById(db, id);
	if (!account || (account.id !== access.user!.id && account.createdByUserId !== access.user!.id)) {
		return NextResponse.json({ error: "Account not found" }, { status: 404 });
	}
	const parsed = updateManagedAccountSchema.safeParse(await request.json());
	if (!parsed.success)
		return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
	if (account.archivedAt) {
		return NextResponse.json({ error: "Archived accounts cannot be edited" }, { status: 409 });
	}
	const destructiveChange =
		(!account.disabled && parsed.data.disabled) ||
		(account.role === "admin" && parsed.data.role !== "admin");
	if (destructiveChange && parsed.data.confirmation !== `update ${account.email}`) {
		return NextResponse.json(
			{ error: `Type “update ${account.email}” to confirm this change` },
			{ status: 400 },
		);
	}
	try {
		await db.batch([
			db
				.update(users)
				.set({
					name: parsed.data.name,
					role: parsed.data.role,
					disabled: parsed.data.disabled,
					canManageMailboxes: parsed.data.canManageMailboxes,
					sendRateLimitPerMinute: parsed.data.sendRateLimitPerMinute,
					dailySendLimit: parsed.data.dailySendLimit,
					...(parsed.data.forwardingEmail !== undefined
						? { forwardingEmail: parsed.data.forwardingEmail }
						: {}),
				})
				.where(eq(users.id, id)),
			db
				.update(mailboxes)
				.set({ displayName: parsed.data.name })
				.where(and(eq(mailboxes.userId, id), eq(mailboxes.type, "personal"))),
		]);
	} catch (error) {
		if (error instanceof Error && error.message.includes("last active administrator")) {
			return NextResponse.json(
				{ error: "Promote another active administrator first" },
				{ status: 409 },
			);
		}
		throw error;
	}
	if (account.role !== parsed.data.role || account.disabled !== parsed.data.disabled) {
		await syncUserMfaPolicyCoverage(access.env, id);
	}
	const accountChanges = {
		name:
			account.name === parsed.data.name ? undefined : { from: account.name, to: parsed.data.name },
		role:
			account.role === parsed.data.role ? undefined : { from: account.role, to: parsed.data.role },
		disabled:
			account.disabled === parsed.data.disabled
				? undefined
				: { from: account.disabled, to: parsed.data.disabled },
		canManageMailboxes:
			account.canManageMailboxes === parsed.data.canManageMailboxes
				? undefined
				: { from: account.canManageMailboxes, to: parsed.data.canManageMailboxes },
	};
	if (Object.values(accountChanges).some((change) => change !== undefined)) {
		await createAuditLog(access.env, {
			actorUserId: access.user!.id,
			targetUserId: id,
			action: "account.updated",
			metadata: accountChanges,
		});
	}
	if (
		account.sendRateLimitPerMinute !== parsed.data.sendRateLimitPerMinute ||
		account.dailySendLimit !== parsed.data.dailySendLimit
	) {
		await createAuditLog(access.env, {
			actorUserId: access.user!.id,
			targetUserId: id,
			action: "account.send_limits_updated",
			metadata: {
				from: { perMinute: account.sendRateLimitPerMinute, daily: account.dailySendLimit },
				to: { perMinute: parsed.data.sendRateLimitPerMinute, daily: parsed.data.dailySendLimit },
			},
		});
	}
	return NextResponse.json({ ok: true });
}
