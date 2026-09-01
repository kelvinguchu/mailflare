import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "./constants";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function sessionCookieOptions(maxAge: number) {
	return {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax" as const,
		path: "/",
		maxAge,
	};
}

export function createAuthenticatedResponse(token: string, redirect: string): NextResponse {
	const response = NextResponse.json({ ok: true, redirect });
	response.headers.set("Cache-Control", "no-store");
	response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_MAX_AGE_SECONDS));
	return response;
}

export function createLoggedOutResponse(): NextResponse {
	const response = NextResponse.json({ ok: true });
	response.headers.set("Cache-Control", "no-store");
	response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
	return response;
}
