"use client";

import type {
	AuthFetchOptions,
	AuthSessionChangedDetail,
	AuthSessionResponse,
} from "./client-types";

const LEGACY_SESSION_STORAGE_KEY = "mailflare-session-token";
let legacySessionStorageCleared = false;
export const AUTH_SESSION_CHANGED_EVENT = "mailflare:auth-session-changed";

function clearLegacySessionStorage(): void {
	if (legacySessionStorageCleared || typeof window === "undefined") return;
	legacySessionStorageCleared = true;
	try {
		localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
	} catch {
		// Storage can be unavailable in restricted browser contexts.
	}
}

export function notifyAuthSessionChanged(authenticated: boolean): void {
	clearLegacySessionStorage();
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent<AuthSessionChangedDetail>(AUTH_SESSION_CHANGED_EVENT, {
			detail: { authenticated },
		}),
	);
}

export async function authFetch(input: RequestInfo | URL, init: AuthFetchOptions = {}): Promise<Response> {
	const { redirectOnUnauthorized = true, headers, ...requestInit } = init;
	clearLegacySessionStorage();
	const response = await fetch(input, {
		...requestInit,
		headers,
		credentials: requestInit.credentials ?? "same-origin",
	});

	if (response.status === 401 && redirectOnUnauthorized && typeof window !== "undefined") {
		notifyAuthSessionChanged(false);
		window.location.assign("/login");
	}

	return response;
}

export async function readAuthSessionResponse(response: Response): Promise<AuthSessionResponse> {
	const data = (await response.json()) as AuthSessionResponse;
	if (response.ok) notifyAuthSessionChanged(true);
	return data;
}
