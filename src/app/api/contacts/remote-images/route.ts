import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { listRemoteImageSenders, setRemoteImagesForSender } from "@/lib/contacts/service";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import type { RemoteImagesRequest } from "./types";

/** Senders whose remote images load automatically in this mailbox. */
export async function GET(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	const mailboxId = new URL(request.url).searchParams.get("mailboxId");
	if (!mailboxId) {
		return NextResponse.json({ error: "Mailbox is required" }, { status: 400 });
	}

	const access = await getMailboxAccessLevel(getDb(env), user, mailboxId);
	if (!access?.canRead) {
		return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	}

	const addresses = await listRemoteImageSenders(env, access.mailbox.userId);
	return NextResponse.json({ addresses });
}

/** Always load, or stop loading, remote images from one sender. */
export async function POST(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	const body = (await request.json()) as RemoteImagesRequest;
	if (!body.mailboxId || !body.address?.trim() || typeof body.allowed !== "boolean") {
		return NextResponse.json({ error: "Mailbox, sender and choice are required" }, { status: 400 });
	}

	const access = await getMailboxAccessLevel(getDb(env), user, body.mailboxId);
	if (!access?.canManage) {
		return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	}

	const result = await setRemoteImagesForSender(env, {
		userId: access.mailbox.userId,
		address: body.address,
		allowed: body.allowed,
	});
	return NextResponse.json(result);
}
