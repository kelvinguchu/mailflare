import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { listDeadLetterEvents } from "@/lib/queues/dead-letters";

export async function GET(request: Request) {
	const env = getEnv();
	try {
		const user = await requireUser(env, request);
		assertAdmin(user);
	} catch {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const url = new URL(request.url);
	const requestedLimit = Number(url.searchParams.get("limit") ?? 100);
	const limit = Number.isFinite(requestedLimit) ? requestedLimit : 100;
	const result = await listDeadLetterEvents(env, limit);
	return NextResponse.json(result);
}
