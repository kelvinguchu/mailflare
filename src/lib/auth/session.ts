import { and, eq, gt, lte, ne, sql } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { SESSION_COOKIE } from "./constants";

export { SESSION_COOKIE } from "./constants";
const SESSION_DAYS = 30;
export const RECENT_AUTHENTICATION_MINUTES = 15;

export function generateSessionToken(): string {
	return newId("sess");
}

export async function hashSessionToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function createSession(env: CloudflareEnv, userId: string): Promise<string> {
	const db = getDb(env);
	const token = generateSessionToken();
	const tokenHash = await hashSessionToken(token);
	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);

	await db.insert(sessions).values({
		id: newId(),
		userId,
		tokenHash,
		kind: "authenticated",
		authenticatedAt: new Date(),
		expiresAt,
	});

	return token;
}

export async function getUserFromSession(
	env: CloudflareEnv,
	token: string | undefined,
): Promise<typeof users.$inferSelect | null> {
	if (!token) return null;
	const db = getDb(env);
	const tokenHash = await hashSessionToken(token);
	const [session] = await db
		.select()
		.from(sessions)
		.where(and(
			eq(sessions.tokenHash, tokenHash),
			eq(sessions.kind, "authenticated"),
			gt(sessions.expiresAt, new Date()),
		))
		.limit(1);
	if (!session) return null;
	const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
	return user ?? null;
}

export async function deleteSession(env: CloudflareEnv, token: string): Promise<void> {
	const db = getDb(env);
	const tokenHash = await hashSessionToken(token);
	await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export async function revokeOtherSessions(
	env: CloudflareEnv,
	userId: string,
	currentToken: string,
): Promise<number> {
	const currentTokenHash = await hashSessionToken(currentToken);
	const result = await getDb(env).delete(sessions).where(and(
		eq(sessions.userId, userId),
		eq(sessions.kind, "authenticated"),
		ne(sessions.tokenHash, currentTokenHash),
	));
	await disconnectUserRealtime(env, userId);
	return result.meta.changes;
}

export async function revokeAllSessions(env: CloudflareEnv, userId: string): Promise<number> {
	const result = await getDb(env).delete(sessions).where(eq(sessions.userId, userId));
	await disconnectUserRealtime(env, userId);
	return result.meta.changes;
}

export async function countActiveSessions(env: CloudflareEnv, userId: string): Promise<number> {
	const [row] = await getDb(env)
		.select({ count: sql<number>`count(*)` })
		.from(sessions)
		.where(and(
			eq(sessions.userId, userId),
			eq(sessions.kind, "authenticated"),
			gt(sessions.expiresAt, new Date()),
		));
	return row?.count ?? 0;
}

export async function getCurrentSessionDetails(
	env: CloudflareEnv,
	userId: string,
	token: string,
): Promise<{ createdAt: Date; expiresAt: Date } | null> {
	const tokenHash = await hashSessionToken(token);
	const [session] = await getDb(env)
		.select({
			createdAt: sessions.createdAt,
			expiresAt: sessions.expiresAt,
			authenticatedAt: sessions.authenticatedAt,
		})
		.from(sessions)
		.where(and(
			eq(sessions.userId, userId),
			eq(sessions.tokenHash, tokenHash),
			eq(sessions.kind, "authenticated"),
			gt(sessions.expiresAt, new Date()),
		))
		.limit(1);
	return session ?? null;
}

export async function markSessionAuthenticated(
	env: CloudflareEnv,
	userId: string,
	token: string,
): Promise<boolean> {
	const tokenHash = await hashSessionToken(token);
	const result = await getDb(env).update(sessions)
		.set({ authenticatedAt: new Date() })
		.where(and(
			eq(sessions.userId, userId),
			eq(sessions.tokenHash, tokenHash),
			eq(sessions.kind, "authenticated"),
			gt(sessions.expiresAt, new Date()),
		));
	return result.meta.changes === 1;
}

export async function isSessionRecentlyAuthenticated(
	env: CloudflareEnv,
	userId: string,
	token: string,
	maxAgeMinutes = RECENT_AUTHENTICATION_MINUTES,
): Promise<boolean> {
	const tokenHash = await hashSessionToken(token);
	const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000);
	const [session] = await getDb(env)
		.select({ id: sessions.id })
		.from(sessions)
		.where(and(
			eq(sessions.userId, userId),
			eq(sessions.tokenHash, tokenHash),
			eq(sessions.kind, "authenticated"),
			gt(sessions.expiresAt, new Date()),
			gt(sessions.authenticatedAt, cutoff),
		))
		.limit(1);
	return !!session;
}

export async function deleteExpiredSessions(env: CloudflareEnv, now = new Date()): Promise<number> {
	const result = await getDb(env).delete(sessions).where(lte(sessions.expiresAt, now));
	return result.meta.changes;
}

export async function disconnectUserRealtime(env: CloudflareEnv, userId: string): Promise<void> {
	if (!env.REALTIME) return;
	try {
		const hub = env.REALTIME.getByName(userId);
		await hub.fetch("https://cc-mail-realtime/disconnect", { method: "POST" });
	} catch (error) {
		console.error(JSON.stringify({
			event: "realtime_session_disconnect_failed",
			userId,
			error: error instanceof Error ? error.message : "Unknown error",
		}));
	}
}
