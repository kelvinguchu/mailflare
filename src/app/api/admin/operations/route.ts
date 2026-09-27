import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/app/api/accounts/utils";
import { requireRecentAuthentication } from "@/lib/auth/recent";
import { createAuditLog } from "@/lib/mailboxes/audit";
import {
	captureOperationalSnapshot,
	getOperationalHealth,
	updateOperationalThresholds,
} from "@/lib/operations/health";

const thresholdsSchema = z.object({
	queueBacklogWarning: z.number().int().min(1).max(1_000_000),
	queueOldestMinutesWarning: z.number().int().min(1).max(10_080),
	deliveryFailed24hWarning: z.number().int().min(1).max(1_000_000),
	deliveryUnknown24hWarning: z.number().int().min(1).max(1_000_000),
	webhookFailed24hWarning: z.number().int().min(1).max(1_000_000),
	reminderFailed24hWarning: z.number().int().min(1).max(1_000_000),
	deadLetterUnresolvedWarning: z.number().int().min(1).max(1_000_000),
	backupStaleHours: z.number().int().min(0).max(8_760),
	d1GrowthPercentWarning: z.number().int().min(1).max(10_000),
	r2GrowthPercentWarning: z.number().int().min(1).max(10_000),
});

export async function GET(request: Request) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	try {
		return NextResponse.json(await getOperationalHealth(access.env));
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "operational_health_read_failed",
				error: error instanceof Error ? error.message : "Unknown operational health error",
			}),
		);
		return NextResponse.json({ error: "Could not load operational health" }, { status: 500 });
	}
}

export async function POST(request: Request) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	try {
		const snapshot = await captureOperationalSnapshot(access.env);
		await createAuditLog(access.env, {
			actorUserId: access.user.id,
			action: "operations.snapshot_captured",
			metadata: {
				d1Bytes: snapshot.d1Bytes,
				r2Bytes: snapshot.r2Bytes,
				r2ObjectCount: snapshot.r2ObjectCount,
				r2ScanComplete: snapshot.r2ScanComplete,
			},
		});
		return NextResponse.json({ snapshot }, { status: 201 });
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "operational_snapshot_failed",
				error: error instanceof Error ? error.message : "Unknown operational snapshot error",
			}),
		);
		return NextResponse.json({ error: "Could not measure storage usage" }, { status: 500 });
	}
}

export async function PUT(request: Request) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	const recentAuthError = await requireRecentAuthentication(access.env, access.user.id);
	if (recentAuthError) return recentAuthError;
	let body: object;
	try {
		body = (await request.json()) as object;
	} catch {
		return NextResponse.json({ error: "Invalid operational thresholds" }, { status: 400 });
	}
	const parsed = thresholdsSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid operational thresholds" }, { status: 400 });
	}
	await updateOperationalThresholds(access.env.DB, parsed.data);
	await createAuditLog(access.env, {
		actorUserId: access.user.id,
		action: "operations.thresholds_updated",
		metadata: parsed.data,
	});
	return NextResponse.json({ ok: true });
}
