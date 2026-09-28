import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getRecipientSuggestions } from "@/lib/contacts/service";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const query = new URL(request.url).searchParams.get("q") ?? "";
	if (query.length > 100) {
		return NextResponse.json({ error: "Search is too long" }, { status: 400 });
	}

	const suggestions = await getRecipientSuggestions(env, user.id, query);
	return NextResponse.json({ suggestions }, { headers: { "Cache-Control": "private, no-store" } });
}
