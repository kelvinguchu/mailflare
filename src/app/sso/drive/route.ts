import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import {
	allowedDriveOrigins,
	createDriveSsoCode,
	driveCallbackUrl,
	driveSsoPath,
	isValidDriveState,
	pickDriveOrigin,
} from "@/lib/drive/sso";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/**
 * Starts a CaliberCode Drive sign-in. Sends the user to the login page first when needed, then
 * back to the drive with a one-time code bound to the drive's `state`.
 */
export async function GET(request: Request) {
	const env = getEnv();
	const allowed = allowedDriveOrigins(env.DRIVE_ORIGINS);
	if (allowed.length === 0) return new NextResponse("Not found", { status: 404, headers: NO_STORE });

	const url = new URL(request.url);
	const state = url.searchParams.get("state");
	const driveOrigin = pickDriveOrigin(url.searchParams.get("drive"), allowed);
	if (!isValidDriveState(state) || !driveOrigin) {
		return new NextResponse("This sign-in link isn't valid. Go back to the drive and try again.", {
			status: 400,
			headers: NO_STORE,
		});
	}

	const user = await getCurrentUser(env, request);
	if (!user) {
		const login = new URL("/login", url.origin);
		login.searchParams.set("next", driveSsoPath(state, driveOrigin));
		return NextResponse.redirect(login, { status: 303, headers: NO_STORE });
	}

	const code = await createDriveSsoCode(env, user.id, state);
	return NextResponse.redirect(driveCallbackUrl(driveOrigin, code, state), { status: 303, headers: NO_STORE });
}
