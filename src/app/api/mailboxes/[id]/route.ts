import { z } from "zod";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { mailboxes, signatureAssets, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import { ensureMailboxDomainRouting } from "@/lib/mailboxes/domain-addresses";
import { updateMailboxSchema } from "@/lib/validators";
import {
	assertSignatureAssetsBelongToMailbox,
	sanitizeMailboxSignature,
} from "@/lib/email/signatures";
import { createAuditLog } from "@/lib/mailboxes/audit";
import type { MailboxRouteParams } from "./types";
import { getMailboxUpdateValues, selectMailboxForUser } from "./utils";

type Db = ReturnType<typeof getDb>;

async function canAdminManageMailbox(
	db: Db,
	user: { id: string; role: "admin" | "user" },
	mailbox: { userId: string },
): Promise<boolean> {
	if (user.role !== "admin") return false;
	if (mailbox.userId === user.id) return true;

	const [owner] = await db
		.select({ createdByUserId: users.createdByUserId })
		.from(users)
		.where(eq(users.id, mailbox.userId))
		.limit(1);

	return owner?.createdByUserId === user.id;
}

export async function GET(request: Request, { params }: MailboxRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	const db = getDb(env);
	const access = await getMailboxAccessLevel(db, user, id);
	const [mailbox] = await selectMailboxForUser(db, user.id, id);

	if (!mailbox || (!access?.canRead && !(await canAdminManageMailbox(db, user, mailbox)))) {
		return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	}
	const { avatarKey, ...mailboxDetails } = mailbox;

	return NextResponse.json({
		mailbox: {
			...mailboxDetails,
			hasAvatar: !!avatarKey,
			permission: access?.permission ?? "full_access",
			isPrimary: `${mailbox.localPart}@${mailbox.hostname}` === user.email,
		},
	});
}

export async function PATCH(request: Request, { params }: MailboxRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	const parsed = updateMailboxSchema.safeParse(await request.json());

	if (!parsed.success) {
		return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
	}

	const db = getDb(env);
	const access = await getMailboxAccessLevel(db, user, id);
	const [existing] = await selectMailboxForUser(db, user.id, id);

	if (!existing || (!access?.canManage && !(await canAdminManageMailbox(db, user, existing)))) {
		return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	}
	if ("displayName" in parsed.data && user.role !== "admin") {
		return NextResponse.json(
			{ error: "Only an administrator can change the sender name" },
			{ status: 403 },
		);
	}

	const updateValues = getMailboxUpdateValues(parsed.data);
	const signatureRequested =
		"signature" in parsed.data || "signatureText" in parsed.data || "signatureHtml" in parsed.data;
	if (signatureRequested) {
		try {
			const legacyUpdate = "signature" in parsed.data;
			const requestedHtml = legacyUpdate
				? null
				: "signatureHtml" in parsed.data
					? parsed.data.signatureHtml
					: existing.signatureHtml;
			const requestedText = legacyUpdate
				? parsed.data.signature
				: "signatureText" in parsed.data
					? parsed.data.signatureText
					: "signatureHtml" in parsed.data && parsed.data.signatureHtml
						? undefined
						: (existing.signatureText ?? existing.signature);
			const signature = sanitizeMailboxSignature({ html: requestedHtml, text: requestedText });
			await assertSignatureAssetsBelongToMailbox(env, id, signature.contentIds);
			updateValues.signature = signature.text;
			updateValues.signatureText = signature.text;
			updateValues.signatureHtml = signature.html;
			updateValues.signatureVersion = existing.signatureVersion + 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Invalid email signature";
			return NextResponse.json({ error: message }, { status: 400 });
		}
	}
	if (parsed.data.useAllDomains === true) {
		try {
			await ensureMailboxDomainRouting(env, db, {
				id: existing.id,
				domainId: existing.domainId,
				localPart: existing.localPart,
				useAllDomains: true,
			});
		} catch (error) {
			console.error("ensureMailboxDomainRouting", error);
			return NextResponse.json(
				{ error: "Failed to configure inbound routing for all domains. Please try saving again." },
				{ status: 502 },
			);
		}
	}
	if (Object.keys(updateValues).length > 0) {
		await db.update(mailboxes).set(updateValues).where(eq(mailboxes.id, id));
	}
	if (signatureRequested) {
		await createAuditLog(env, {
			actorUserId: user.id,
			mailboxId: id,
			action: "mailbox.signature_update",
			metadata: { version: updateValues.signatureVersion },
		});
	}

	const [mailbox] = await selectMailboxForUser(db, user.id, id);
	const { avatarKey, ...mailboxDetails } = mailbox!;

	return NextResponse.json({
		mailbox: {
			...mailboxDetails,
			hasAvatar: !!avatarKey,
			permission: access?.permission ?? "full_access",
			isPrimary: `${mailbox!.localPart}@${mailbox!.hostname}` === user.email,
		},
	});
}

export async function DELETE(request: Request, { params }: MailboxRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	const db = getDb(env);
	const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.id, id)).limit(1);
	if (!mailbox) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });

	let allowed = mailbox.userId === user.id && user.canManageMailboxes;
	if (!allowed) allowed = await canAdminManageMailbox(db, user, mailbox);
	if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	const assets = await db
		.select({ r2Key: signatureAssets.r2Key })
		.from(signatureAssets)
		.where(eq(signatureAssets.mailboxId, id));
	await db.delete(mailboxes).where(eq(mailboxes.id, id));
	const cleanup = await Promise.allSettled(assets.map((asset) => env.BUCKET.delete(asset.r2Key)));
	if (cleanup.some((result) => result.status === "rejected")) {
		console.error("Failed to remove one or more orphaned mailbox signature images", {
			mailboxId: id,
		});
	}
	return NextResponse.json({ ok: true });
}
