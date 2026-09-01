import { cookies } from "next/headers";
import { getEnv } from "@/lib/cloudflare";
import { deleteSession, getUserFromSession, SESSION_COOKIE } from "@/lib/auth/session";
import { createLoggedOutResponse } from "@/lib/auth/http-response";
import { recordAuthActivity } from "@/lib/auth/activity";

export async function POST(request: Request) {
	const env = getEnv();
	const jar = await cookies();
	const token = jar.get(SESSION_COOKIE)?.value;
	if (token) {
		const user = await getUserFromSession(env, token);
		if (user) await recordAuthActivity(env, { action: "auth.logout", userId: user.id, request });
		await deleteSession(env, token);
	}

	return createLoggedOutResponse();
}
