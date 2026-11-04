import { notFound } from "next/navigation";
import { getEnv } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/cookies";
import { canInspectTeam } from "@/lib/team-inboxes/policy";
import { TeamCalendarView } from "@/components/team-calendar/team-calendar-view";
export default async function TeamCalendarPage() {
	const env = getEnv(),
		user = await getCurrentUser(env);
	if (!user || !canInspectTeam(env, user)) notFound();
	return <TeamCalendarView key={user.id} viewerId={user.id} />;
}

export const dynamic = "force-dynamic";
