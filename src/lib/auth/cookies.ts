import { cookies } from "next/headers";
import {
	SESSION_COOKIE,
	getPolicyAuthorizedUserFromSession,
	getUserFromSession,
} from "@/lib/auth/session";

export async function getCurrentSessionUser(env: CloudflareEnv, _request?: Request) {
	const jar = await cookies();
	const token = jar.get(SESSION_COOKIE)?.value;
	const user = await getUserFromSession(env, token);
	return user?.disabled || user?.activationStatus !== "active" ? null : user;
}

export async function getCurrentUser(env: CloudflareEnv, _request?: Request) {
	const jar = await cookies();
	return getPolicyAuthorizedUserFromSession(env, jar.get(SESSION_COOKIE)?.value);
}

export async function requireUser(env: CloudflareEnv, request?: Request) {
	const user = await getCurrentUser(env, request);
	if (!user) throw new Error("Unauthorized");
	return user;
}
