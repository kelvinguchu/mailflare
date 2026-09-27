import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { buildMessageCountsFromAggregateRows } from "./utils";
import { queryMessageCountAggregates } from "./query";
import type { MessageCountScope } from "./query";
import { getMailboxAccessLevel, listAccessibleMailboxIds } from "@/lib/mailboxes/access";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const url = new URL(request.url);
	const mailboxId = url.searchParams.get("mailboxId");
	const threadView = url.searchParams.get("view") === "threads";
	const db = getDb(env);
	let scope: MessageCountScope;

	if (mailboxId) {
		const access = await getMailboxAccessLevel(db, user, mailboxId);
		if (!access?.canRead) {
			return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
		}
		scope = { mailboxId };
	} else {
		const accessibleMailboxIds = await listAccessibleMailboxIds(db, user);
		if (accessibleMailboxIds.length > 0) {
			scope = { accessibleMailboxIds };
		} else {
			scope = { userId: user.id };
		}
	}

	const rows = await queryMessageCountAggregates(env.DB, scope, threadView);

	return NextResponse.json({ counts: buildMessageCountsFromAggregateRows(rows) });
}
