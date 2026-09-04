import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/cookies";
import { MAX_DATABASE_RESTORE_BYTES } from "@/lib/backups/format";
import { restoreDatabaseRecords, restoreTooLargeError } from "@/lib/backups/restore";
import { getEnv } from "@/lib/cloudflare";

const MAX_RESTORE_REQUEST_BYTES = MAX_DATABASE_RESTORE_BYTES + 64 * 1024;

export async function POST(request: Request) {
	const env = getEnv();
	try {
		const user = await requireUser(env, request);
		assertAdmin(user);
		const contentLength = Number(request.headers.get("content-length"));
		if (Number.isFinite(contentLength) && contentLength > MAX_RESTORE_REQUEST_BYTES) {
			return NextResponse.json({ error: restoreTooLargeError().message }, { status: 413 });
		}
		const form = await request.formData();
		const file = form.get("backup");
		if (!(file instanceof File)) return NextResponse.json({ error: "Choose a backup file" }, { status: 400 });
		if (file.size > MAX_DATABASE_RESTORE_BYTES) {
			return NextResponse.json({ error: restoreTooLargeError().message }, { status: 413 });
		}
		const result = await restoreDatabaseRecords(env, await file.arrayBuffer());
		return NextResponse.json({ ok: true, ...result });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to restore backup";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
