import { createAuditLog } from "@/lib/mailboxes/audit";
import { privateHeaders, requireTeamInspector } from "@/lib/team-inboxes/auth";

export async function POST(request: Request) {
	const access = await requireTeamInspector(request);
	if (access.error) return access.error;
	await createAuditLog(access.env, {
		actorUserId: access.user.id,
		action: "team_calendar.inspection_started",
	});
	return Response.json({ ok: true }, { headers: privateHeaders });
}
