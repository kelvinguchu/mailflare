import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { mailboxes, signatureAssets } from "@/db/schema";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { extractSignatureContentIds } from "@/lib/email/signatures";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import { createAuditLog } from "@/lib/mailboxes/audit";
import type { SignatureAssetRouteParams } from "./types";

export async function GET(request: Request, { params }: SignatureAssetRouteParams) {
	const { assetId, id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	const db = getDb(env);
	const access = await getMailboxAccessLevel(db, user, id);
	if (!access?.canRead) return new Response("Not found", { status: 404 });
	const [asset] = await db
		.select()
		.from(signatureAssets)
		.where(and(eq(signatureAssets.id, assetId), eq(signatureAssets.mailboxId, id)))
		.limit(1);
	if (!asset) return new Response("Not found", { status: 404 });
	const object = await env.BUCKET.get(asset.r2Key);
	if (!object) return new Response("Not found", { status: 404 });

	const headers = new Headers();
	headers.set("Content-Type", asset.contentType);
	headers.set("Content-Disposition", `inline; filename="${asset.filename.replace(/"/g, "")}"`);
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; sandbox");
	headers.set("Cache-Control", "private, no-store");
	return new Response(object.body, { headers });
}

export async function DELETE(request: Request, { params }: SignatureAssetRouteParams) {
	const { assetId, id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	const db = getDb(env);
	const access = await getMailboxAccessLevel(db, user, id);
	if (!access?.canManage) {
		return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	}
	const [asset] = await db
		.select()
		.from(signatureAssets)
		.where(and(eq(signatureAssets.id, assetId), eq(signatureAssets.mailboxId, id)))
		.limit(1);
	if (!asset) return NextResponse.json({ error: "Image not found" }, { status: 404 });
	const [mailbox] = await db
		.select({ signatureHtml: mailboxes.signatureHtml })
		.from(mailboxes)
		.where(eq(mailboxes.id, id))
		.limit(1);
	if (extractSignatureContentIds(mailbox?.signatureHtml).includes(asset.contentId)) {
		return NextResponse.json(
			{ error: "Remove this image from the signature before deleting it" },
			{ status: 409 },
		);
	}

	await db.delete(signatureAssets).where(eq(signatureAssets.id, asset.id));
	try {
		await env.BUCKET.delete(asset.r2Key);
	} catch (error) {
		console.error("Failed to remove orphaned signature image", { assetId: asset.id, error });
	}
	await createAuditLog(env, {
		actorUserId: user.id,
		mailboxId: id,
		action: "mailbox.signature_asset_delete",
		metadata: { assetId: asset.id },
	});
	return NextResponse.json({ ok: true });
}
