import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/cookies";
import { getD1ExportConfigurationStatus } from "@/lib/backups/export";
import {
	createBackupRecord,
	getBackupSettings,
	listBackups,
	startBackupWorkflow,
	updateBackupSettings,
} from "@/lib/backups/service";
import { BackupWorkflowUnavailableError } from "@/lib/backups/utils";
import { getEnv } from "@/lib/cloudflare";
import { parseBackupSettingsInput } from "./utils";

async function requireAdmin(request: Request) {
	const env = getEnv();
	const user = await requireUser(env, request);
	assertAdmin(user);
	return { env, user };
}

export async function GET(request: Request) {
	try {
		const { env } = await requireAdmin(request);
		const [settings, backupList] = await Promise.all([
			getBackupSettings(env),
			listBackups(env),
		]);
		return NextResponse.json({
			settings,
			backups: backupList,
			configuration: getD1ExportConfigurationStatus(env),
		});
	} catch {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
}

export async function PUT(request: Request) {
	try {
		const { env } = await requireAdmin(request);
		const input = parseBackupSettingsInput(await request.json());
		if (!input) return NextResponse.json({ error: "Invalid backup settings" }, { status: 400 });
		await updateBackupSettings(env, input);
		return NextResponse.json({ ok: true });
	} catch {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
}

export async function POST(request: Request) {
	try {
		const { env, user } = await requireAdmin(request);
		const backupId = await createBackupRecord(env, "manual", user.id);
		await startBackupWorkflow(env, backupId);
		return NextResponse.json({ backupId }, { status: 202 });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to start backup";
		const status = error instanceof BackupWorkflowUnavailableError ? 503 : 400;
		return NextResponse.json({ error: message }, { status });
	}
}
