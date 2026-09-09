import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listRecentSignIns } from "@/lib/auth/activity";
import { getCurrentUser } from "@/lib/auth/cookies";
import {
	SESSION_COOKIE,
	countActiveSessions,
	getCurrentSessionDetails,
	revokeOtherSessions,
} from "@/lib/auth/session";
import { getEnv } from "@/lib/cloudflare";
import { createAuditLog } from "@/lib/mailboxes/audit";
import type { AuthActivityMetadata } from "@/lib/auth/activity-types";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	const token = (await cookies()).get(SESSION_COOKIE)?.value;
	if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const [activeSessionCount, currentSession, recentRows] = await Promise.all([
		countActiveSessions(env, user.id),
		getCurrentSessionDetails(env, user.id, token),
		listRecentSignIns(env, user.id),
	]);

	return NextResponse.json({
		activeSessionCount,
		currentSession,
		recentSignIns: recentRows.map((row) => ({
			id: row.id,
			createdAt: row.createdAt,
			...parseActivityMetadata(row.metadata),
		})),
	});
}

export async function DELETE(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	const token = (await cookies()).get(SESSION_COOKIE)?.value;
	if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const revokedSessions = await revokeOtherSessions(env, user.id, token);
	await createAuditLog(env, {
		actorUserId: user.id,
		targetUserId: user.id,
		action: "auth.sessions_revoked",
		metadata: { scope: "other", revokedSessions },
	});
	return NextResponse.json({ ok: true, revokedSessions });
}

function parseActivityMetadata(metadata: string | null): Omit<AuthActivityMetadata, "userAgent"> {
	const fallback: Omit<AuthActivityMetadata, "userAgent"> = {
		ipAddress: "Unknown",
		city: null,
		country: null,
		device: "Unknown",
		platform: "Unknown",
	};
	if (!metadata) return fallback;
	try {
		const parsed = JSON.parse(metadata) as Partial<AuthActivityMetadata>;
		return {
			ipAddress: typeof parsed.ipAddress === "string" ? parsed.ipAddress : fallback.ipAddress,
			city: typeof parsed.city === "string" ? parsed.city : null,
			country: typeof parsed.country === "string" ? parsed.country : null,
			device: typeof parsed.device === "string" ? parsed.device : fallback.device,
			platform: typeof parsed.platform === "string" ? parsed.platform : fallback.platform,
		};
	} catch {
		return fallback;
	}
}
