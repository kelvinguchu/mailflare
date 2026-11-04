import { CalendarInputError } from "@/lib/calendar/validation";
import { listTeamCalendar, teamCalendarRange } from "@/lib/team-calendar/service";
import { privateHeaders, requireTeamInspector } from "@/lib/team-inboxes/auth";

export async function GET(request: Request) {
	const access = await requireTeamInspector(request);
	if (access.error) return access.error;
	try {
		const range = teamCalendarRange(new URL(request.url).searchParams);
		return Response.json(await listTeamCalendar(access.env, range), { headers: privateHeaders });
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return Response.json(
				{ error: error.message },
				{ status: error.status, headers: privateHeaders },
			);
		}
		throw error;
	}
}
