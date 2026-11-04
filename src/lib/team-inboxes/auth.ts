import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { canInspectTeam } from "./policy";
export const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function requireTeamInspector(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user)
		return {
			error: Response.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders }),
		};
	if (!canInspectTeam(env, user))
		return {
			error: Response.json({ error: "Forbidden" }, { status: 403, headers: privateHeaders }),
		};
	return { env, user };
}
