import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { calendarEvents } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/cookies";
import {
	advisorySchedule,
	blockEventId,
	canManageAdvisory,
} from "@/lib/calendar/calibercode-schedule";
import { getEnv } from "@/lib/cloudflare";

/** Lifts a block, so the booking page offers that time again, and removes its entry. */
export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ blockId: string }> },
) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	if (!canManageAdvisory(user)) {
		return NextResponse.json(
			{ error: "Only Mohamed or an admin can remove a block" },
			{ status: 403 },
		);
	}

	const { blockId } = await params;
	if (!/^\d+$/.test(blockId))
		return NextResponse.json({ error: "Block not found" }, { status: 404 });
	const id = blockEventId(Number(blockId));
	const db = getDb(env);
	const owned = and(eq(calendarEvents.id, id), eq(calendarEvents.userId, user.id));
	const [event] = await db.select().from(calendarEvents).where(owned).limit(1);
	if (!event) return NextResponse.json({ error: "Block not found" }, { status: 404 });

	const schedule = advisorySchedule(env);
	if (!schedule) {
		return NextResponse.json(
			{ error: "Removing CaliberCode blocks is only available in production" },
			{ status: 503 },
		);
	}
	try {
		const result = await schedule.unblock({ blockId: Number(blockId) });
		if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
	} catch (error) {
		console.error("CaliberCode unblock failed", error);
		return NextResponse.json(
			{ error: "CaliberCode could not be reached. Nothing was changed - try again." },
			{ status: 502 },
		);
	}

	await db.delete(calendarEvents).where(owned);
	return NextResponse.json({ ok: true });
}
