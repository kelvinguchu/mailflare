import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthGuard } from "@/components/auth/auth-guard";
import { hasAdminAccount } from "@/lib/auth/setup";
import { getUserFromSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getEnv } from "@/lib/cloudflare";
import { LoginClient } from "./login-client";
import { evaluateUserMfaPolicy } from "@/lib/auth/mfa-policy";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
	const env = getEnv();
	if (!(await hasAdminAccount(env))) redirect("/setup");
	const cookieStore = await cookies();
	const user = await getUserFromSession(env, cookieStore.get(SESSION_COOKIE)?.value);
	if (user && !user.disabled) {
		const policy = await evaluateUserMfaPolicy(env, user);
		redirect(policy.state === "restricted" ? "/enroll-mfa" : "/inbox");
	}

	return (
		<AuthGuard mode="public">
			<LoginClient />
		</AuthGuard>
	);
}
