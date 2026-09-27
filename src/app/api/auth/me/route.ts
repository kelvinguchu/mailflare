import { NextResponse } from "next/server";
import { getCurrentSessionUser } from "@/lib/auth/cookies";
import { evaluateMfaPolicy, getMfaPolicy } from "@/lib/auth/mfa-policy";
import { getEnv } from "@/lib/cloudflare";
import { hasPrimaryDomain, userHasMailboxes } from "@/lib/user";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentSessionUser(env, request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let hasMailboxes = false;
	let isSetup = true;
	try {
		[hasMailboxes, isSetup] = await Promise.all([
			userHasMailboxes(env, user.id),
			hasPrimaryDomain(env),
		]);
	} catch {
		// Authentication remains valid when optional mailbox/setup metadata is unavailable.
	}
	const mfaPolicy = await getMfaPolicy(env);
	const mfaPolicyStatus = evaluateMfaPolicy(user, mfaPolicy);
	return NextResponse.json({
		user: {
			id: user.id,
			email: user.email,
			name: user.name,
			resetEmail: user.resetEmail,
			resetEmailVerified: !!user.resetEmailVerifiedAt,
			forwardingEmail: user.forwardingEmail,
			role: user.role,
			mfaEnabled: !!user.mfaEnabledAt,
			canManageMailboxes: user.canManageMailboxes,
			hasAvatar: !!user.avatarKey,
		},
		mfaPolicy: {
			mode: mfaPolicy.mode,
			gracePeriodDays: mfaPolicy.gracePeriodDays,
			state: mfaPolicyStatus.state,
			required: mfaPolicyStatus.required,
			deadline: mfaPolicyStatus.deadline?.toISOString() ?? null,
			exemptUntil: mfaPolicyStatus.exemptUntil?.toISOString() ?? null,
		},
		hasMailboxes,
		isSetup,
	});
}
