import type { SessionUser } from "@/lib/auth/types";
export function inspectionOwnerEmail(env: Pick<CloudflareEnv, "DEPLOYMENT_ENV">): string | null {
	return env.DEPLOYMENT_ENV === "production"
		? "mohamed@calibercode.io"
		: env.DEPLOYMENT_ENV === "local"
			? "admin@example.com"
			: null;
}
export function canInspectTeam(
	env: Pick<CloudflareEnv, "DEPLOYMENT_ENV">,
	user: Pick<SessionUser, "email" | "disabled" | "activationStatus">,
): boolean {
	return (
		!user.disabled &&
		user.activationStatus === "active" &&
		user.email.toLowerCase() === inspectionOwnerEmail(env)
	);
}
