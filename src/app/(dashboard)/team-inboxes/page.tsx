import { notFound } from "next/navigation";
import { getEnv } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/cookies";
import { canInspectTeam } from "@/lib/team-inboxes/policy";
import { TeamInboxView } from "@/components/team-inboxes/team-inbox-view";
export default async function TeamInboxPage() {
	const env = getEnv(),
		user = await getCurrentUser(env);
	if (!user || !canInspectTeam(env, user)) notFound();
	return <TeamInboxView key={user.id} identity={user.id} mfaEnabled={!!user.mfaEnabledAt} />;
}

export const dynamic = "force-dynamic";
