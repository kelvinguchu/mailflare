import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import {
	isSignatureImageFile,
	listSignatureAssets,
	MAX_SIGNATURE_ASSET_SIZE,
	storeSignatureAsset,
} from "@/lib/email/signature-assets";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { readFormDataBody } from "@/lib/http/request";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import { createAuditLog } from "@/lib/mailboxes/audit";
import type { SignatureAssetsRouteParams } from "./types";

const MAX_SIGNATURE_ASSET_REQUEST_SIZE = MAX_SIGNATURE_ASSET_SIZE + 64 * 1024;

export async function GET(request: Request, { params }: SignatureAssetsRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	const access = await getMailboxAccessLevel(getDb(env), user, id);
	if (!access?.canRead) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	return NextResponse.json({ assets: await listSignatureAssets(env, id) });
}

export async function POST(request: Request, { params }: SignatureAssetsRouteParams) {
	const { id } = await params;
	const env = getEnv();
	const user = await requireUser(env, request);
	const access = await getMailboxAccessLevel(getDb(env), user, id);
	if (!access?.canManage) {
		return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	}

	let form: FormData;
	try {
		form = await readFormDataBody(request, MAX_SIGNATURE_ASSET_REQUEST_SIZE);
	} catch (error) {
		const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
		return NextResponse.json({ error: "Invalid signature image upload" }, { status });
	}
	const file = form.get("file");
	if (!isSignatureImageFile(file)) {
		return NextResponse.json({ error: "Missing image file" }, { status: 400 });
	}
	const altText = String(form.get("altText") ?? "").trim();
	if (altText.length > 200) {
		return NextResponse.json(
			{ error: "Alternative text cannot exceed 200 characters" },
			{ status: 400 },
		);
	}

	try {
		const asset = await storeSignatureAsset(env, {
			mailboxId: id,
			uploadedByUserId: user.id,
			filename: file.name,
			type: file.type,
			content: await file.arrayBuffer(),
			altText,
		});
		await createAuditLog(env, {
			actorUserId: user.id,
			mailboxId: id,
			action: "mailbox.signature_asset_upload",
			metadata: { assetId: asset.id, contentType: asset.type, size: asset.size },
		});
		return NextResponse.json({ asset }, { status: 201 });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Signature image upload failed";
		const status = message.includes("512 KB") || message.includes("2 MB") ? 413 : 400;
		return NextResponse.json({ error: message }, { status });
	}
}
