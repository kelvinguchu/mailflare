import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin } from "@/app/api/accounts/utils";
import { requireRecentAuthentication } from "@/lib/auth/recent";
import { evaluateMfaPolicy, getMfaPolicy, updateMfaPolicy } from "@/lib/auth/mfa-policy";
import { isMfaEnabled } from "@/lib/auth/mfa";
import { createAuditLog } from "@/lib/mailboxes/audit";
import { mfaPolicySchema } from "@/lib/validators";
import { RequestBodyTooLargeError } from "@/lib/http/errors";
import { readJsonBody } from "@/lib/http/request";

export async function GET(request: Request) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	return NextResponse.json(await policyResponse(access.env));
}

export async function PUT(request: Request) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	const recentAuthError = await requireRecentAuthentication(access.env, access.user!.id);
	if (recentAuthError) return recentAuthError;
	let body: unknown;
	try {
		body = await readJsonBody(request, 8 * 1024);
	} catch (error) {
		return NextResponse.json(
			{ error: "Invalid MFA policy" },
			{ status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
		);
	}
	const parsed = mfaPolicySchema.safeParse(body);
	if (!parsed.success) return NextResponse.json({ error: "Invalid MFA policy" }, { status: 400 });
	if (parsed.data.mode !== "optional") {
		if (!isMfaEnabled(access.user!)) {
			return NextResponse.json(
				{ error: "Enable MFA on your own administrator account before enforcing it" },
				{ status: 409 },
			);
		}
		if (recoveryCodeCount(access.user!.mfaRecoveryCodeHashes) < 1) {
			return NextResponse.json(
				{ error: "Generate and save at least one recovery code before enforcing MFA" },
				{ status: 409 },
			);
		}
	}
	const previous = await getMfaPolicy(access.env);
	await updateMfaPolicy(access.env, {
		...parsed.data,
		actorUserId: access.user!.id,
	});
	await createAuditLog(access.env, {
		actorUserId: access.user!.id,
		targetUserId: access.user!.id,
		action: "auth.mfa_policy_updated",
		metadata: {
			from: { mode: previous.mode, gracePeriodDays: previous.gracePeriodDays },
			to: parsed.data,
		},
	});
	return NextResponse.json(await policyResponse(access.env));
}

async function policyResponse(env: CloudflareEnv) {
	const policy = await getMfaPolicy(env);
	const accounts = await getDb(env).select().from(users);
	const counts = { covered: 0, compliant: 0, grace: 0, exempt: 0, restricted: 0 };
	for (const account of accounts) {
		const evaluation = evaluateMfaPolicy(account, policy);
		if (!evaluation.required) continue;
		counts.covered += 1;
		if (evaluation.state !== "not_required") counts[evaluation.state] += 1;
	}
	return {
		policy: {
			mode: policy.mode,
			gracePeriodDays: policy.gracePeriodDays,
			updatedAt: policy.updatedAt.toISOString(),
		},
		counts,
	};
}

function recoveryCodeCount(value: string): number {
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.length : 0;
	} catch {
		return 0;
	}
}
