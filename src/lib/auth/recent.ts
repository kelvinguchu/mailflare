import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isSessionRecentlyAuthenticated, SESSION_COOKIE } from "./session";

export async function requireRecentAuthentication(
	env: CloudflareEnv,
	userId: string,
): Promise<NextResponse | null> {
	const token = (await cookies()).get(SESSION_COOKIE)?.value;
	if (token && await isSessionRecentlyAuthenticated(env, userId, token)) return null;
	return NextResponse.json(
		{
			error: "Confirm your password and multi-factor code before this action.",
			code: "RECENT_AUTHENTICATION_REQUIRED",
		},
		{ status: 428 },
	);
}
