import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { createDriveSsoCode, driveCallbackUrl, isValidDriveState } from "@/lib/drive/sso";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/**
 * Starts a CaliberCode Drive sign-in. Sends the user to the login page first when needed, then
 * back to the drive with a one-time code bound to the drive's `state`.
 */
export async function GET(request: Request) {
	const env = getEnv();
	if (!env.DRIVE_ORIGIN) return new NextResponse("Not found", { status: 404, headers: NO_STORE });

	const url = new URL(request.url);
	const state = url.searchParams.get("state");
	if (!isValidDriveState(state)) {
		return new NextResponse("This sign-in link isn't valid. Go back to the drive and try again.", {
			status: 400,
			headers: NO_STORE,
		});
	}

	const user = await getCurrentUser(env, request);
	if (!user) {
		const login = new URL("/login", url.origin);
		login.searchParams.set("next", `/sso/drive?state=${state}`);
		return NextResponse.redirect(login, { status: 303, headers: NO_STORE });
	}

	const code = await createDriveSsoCode(env, user.id, state);
	return NextResponse.redirect(driveCallbackUrl(env.DRIVE_ORIGIN, code, state), { status: 303, headers: NO_STORE });
}
