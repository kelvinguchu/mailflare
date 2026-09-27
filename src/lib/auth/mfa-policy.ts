import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { mfaPolicySettings, users } from "@/db/schema";

export const MFA_POLICY_SETTINGS_ID = "default";
export const DEFAULT_MFA_GRACE_DAYS = 7;

export type MfaPolicyMode = "optional" | "administrators" | "all_users";
export type MfaPolicyState = "not_required" | "compliant" | "grace" | "exempt" | "restricted";

export type MfaPolicy = {
	mode: MfaPolicyMode;
	gracePeriodDays: number;
	updatedAt: Date;
};

export type MfaPolicyEvaluation = {
	state: MfaPolicyState;
	required: boolean;
	deadline: Date | null;
	exemptUntil: Date | null;
	exemptionReason: string | null;
};

type PolicyUser = Pick<
	typeof users.$inferSelect,
	| "role"
	| "activationStatus"
	| "disabled"
	| "archivedAt"
	| "mfaSecretEncrypted"
	| "mfaEnabledAt"
	| "mfaPolicyCoveredAt"
	| "mfaPolicyExemptUntil"
	| "mfaPolicyExemptionReason"
>;

export async function getMfaPolicy(env: CloudflareEnv): Promise<MfaPolicy> {
	const [row] = await getDb(env)
		.select()
		.from(mfaPolicySettings)
		.where(eq(mfaPolicySettings.id, MFA_POLICY_SETTINGS_ID))
		.limit(1);
	return row
		? { mode: row.mode, gracePeriodDays: row.gracePeriodDays, updatedAt: row.updatedAt }
		: { mode: "optional", gracePeriodDays: DEFAULT_MFA_GRACE_DAYS, updatedAt: new Date() };
}

export function isUserCoveredByMfaPolicy(user: PolicyUser, mode: MfaPolicyMode): boolean {
	if (
		mode === "optional" ||
		user.activationStatus !== "active" ||
		user.disabled ||
		user.archivedAt
	) {
		return false;
	}
	return mode === "all_users" || user.role === "admin";
}

export function evaluateMfaPolicy(
	user: PolicyUser,
	policy: MfaPolicy,
	now = new Date(),
): MfaPolicyEvaluation {
	if (!isUserCoveredByMfaPolicy(user, policy.mode)) return result("not_required", false);
	if (user.mfaSecretEncrypted && user.mfaEnabledAt) return result("compliant", true);
	if (user.mfaPolicyExemptUntil && user.mfaPolicyExemptUntil.getTime() > now.getTime()) {
		return {
			state: "exempt",
			required: true,
			deadline: null,
			exemptUntil: user.mfaPolicyExemptUntil,
			exemptionReason: user.mfaPolicyExemptionReason,
		};
	}
	const coveredAt = user.mfaPolicyCoveredAt ?? policy.updatedAt;
	const deadline = new Date(coveredAt.getTime() + policy.gracePeriodDays * 86_400_000);
	return {
		state: deadline.getTime() > now.getTime() ? "grace" : "restricted",
		required: true,
		deadline,
		exemptUntil: null,
		exemptionReason: null,
	};
}

export function isMfaPolicyRestricted(evaluation: MfaPolicyEvaluation): boolean {
	return evaluation.state === "restricted";
}

export async function evaluateUserMfaPolicy(
	env: CloudflareEnv,
	user: PolicyUser,
	now = new Date(),
): Promise<MfaPolicyEvaluation> {
	return evaluateMfaPolicy(user, await getMfaPolicy(env), now);
}

export async function syncUserMfaPolicyCoverage(
	env: CloudflareEnv,
	userId: string,
	now = new Date(),
): Promise<void> {
	const db = getDb(env);
	const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
	if (!user) return;
	const policy = await getMfaPolicy(env);
	await db
		.update(users)
		.set({
			mfaPolicyCoveredAt: isUserCoveredByMfaPolicy(user, policy.mode)
				? (user.mfaPolicyCoveredAt ?? now)
				: null,
		})
		.where(eq(users.id, userId));
}

export async function updateMfaPolicy(
	env: CloudflareEnv,
	input: { mode: MfaPolicyMode; gracePeriodDays: number; actorUserId: string },
	now = new Date(),
): Promise<void> {
	const nowSeconds = Math.floor(now.getTime() / 1_000);
	const coverageUpdate =
		input.mode === "optional"
			? env.DB.prepare("UPDATE users SET mfa_policy_covered_at = NULL")
			: input.mode === "administrators"
				? env.DB.prepare(
						`UPDATE users SET mfa_policy_covered_at = CASE
							WHEN role = 'admin' AND activation_status = 'active' AND disabled = 0
								AND archived_at IS NULL THEN coalesce(mfa_policy_covered_at, ?)
							ELSE NULL END`,
					).bind(nowSeconds)
				: env.DB.prepare(
						`UPDATE users SET mfa_policy_covered_at = CASE
							WHEN activation_status = 'active' AND disabled = 0 AND archived_at IS NULL
								THEN coalesce(mfa_policy_covered_at, ?)
							ELSE NULL END`,
					).bind(nowSeconds);
	await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO mfa_policy_settings
					(id, mode, grace_period_days, updated_by_user_id, updated_at)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET mode = excluded.mode,
					grace_period_days = excluded.grace_period_days,
					updated_by_user_id = excluded.updated_by_user_id,
					updated_at = excluded.updated_at`,
		).bind(
			MFA_POLICY_SETTINGS_ID,
			input.mode,
			input.gracePeriodDays,
			input.actorUserId,
			nowSeconds,
		),
		coverageUpdate,
	]);
}

function result(state: "not_required" | "compliant", required: boolean): MfaPolicyEvaluation {
	return {
		state,
		required,
		deadline: null,
		exemptUntil: null,
		exemptionReason: null,
	};
}
