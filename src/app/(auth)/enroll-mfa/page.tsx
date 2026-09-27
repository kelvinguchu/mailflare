import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { MfaEnrollment } from "@/components/auth/mfa-enrollment";
import { getEnv } from "@/lib/cloudflare";
import { getUserFromSession, SESSION_COOKIE } from "@/lib/auth/session";
import { evaluateUserMfaPolicy } from "@/lib/auth/mfa-policy";

export const dynamic = "force-dynamic";

export default async function EnrollMfaPage() {
	const env = getEnv();
	const token = (await cookies()).get(SESSION_COOKIE)?.value;
	const user = await getUserFromSession(env, token);
	if (!user || user.disabled || user.activationStatus !== "active") redirect("/login");
	const policy = await evaluateUserMfaPolicy(env, user);
	if (policy.state !== "restricted" && policy.state !== "grace") redirect("/inbox");

	return (
		<AuthShell
			wide
			icon={ShieldCheck}
			title="Secure your account"
			description="Your workspace requires an authenticator app before you continue."
		>
			<MfaEnrollment />
		</AuthShell>
	);
}
