import { encode } from "uqr";
import { authFetch } from "@/lib/auth/client";
import type { MfaRequestContext, MfaSetupDetails, MfaStatus } from "./types";

export class MfaRequestError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "MfaRequestError";
		this.status = status;
	}
}

/** Builds the QR module matrix locally; the secret never leaves the browser for rendering. */
export function getQrMatrix(otpauthUri: string): boolean[][] {
	return encode(otpauthUri, { ecc: "M", border: 0 }).data;
}

/** Authenticator apps show codes in groups; the API expects the digits alone. */
export function normalizeTotpCode(value: string): string {
	return value.replace(/[\s-]/g, "");
}

export function isSixDigitCode(value: string): boolean {
	return /^\d{6}$/.test(normalizeTotpCode(value));
}

/** Groups the manual key in fours so it can be read and typed reliably. */
export function formatSetupKey(secret: string): string {
	return secret
		.replace(/\s/g, "")
		.replace(/(.{4})/g, "$1 ")
		.trim();
}

export function buildRecoveryCodesText(codes: string[], generatedAt = new Date()): string {
	return [
		"CC Mail recovery codes",
		`Generated ${generatedAt.toISOString()}`,
		"",
		"Each code works once. Store them somewhere safe and private.",
		"",
		...codes,
		"",
	].join("\n");
}

/** Maps an MFA API failure to a message that says what to do next. */
export function describeMfaError(error: unknown, context: MfaRequestContext): string {
	if (!(error instanceof MfaRequestError)) {
		return "CC Mail couldn’t be reached. Check your connection and try again.";
	}
	if (error.status === 429) return "Too many attempts. Wait a few minutes before trying again.";
	if (context === "begin") {
		if (error.status === 401) return "That password is incorrect.";
		if (error.status === 409) return "Multi-factor authentication is already enabled.";
	}
	if (context === "verify") {
		if (error.status === 401) {
			return "That code didn’t match. Enter the newest code from your authenticator app.";
		}
		if (error.status === 409) {
			return "This setup key expired or was replaced. Start setup again to get a new key.";
		}
	}
	if (context === "protected" && error.status === 401) {
		return error.message === "Invalid verification code"
			? "That authenticator or recovery code didn’t match."
			: "That password is incorrect.";
	}
	if (error.status >= 500) return "Something went wrong on the server. Try again.";
	return error.message;
}

export async function loadMfaStatus(): Promise<MfaStatus> {
	const response = await authFetch("/api/settings/mfa", { cache: "no-store" });
	const data = (await response.json().catch(() => ({}))) as MfaStatus & { error?: string };
	if (!response.ok) {
		throw new MfaRequestError(data.error ?? "Failed to load security settings", response.status);
	}
	return data;
}

export async function requestMfa<T>(
	method: "POST" | "PUT" | "PATCH" | "DELETE",
	body: Record<string, string>,
): Promise<T> {
	const response = await authFetch("/api/settings/mfa", {
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const data = (await response.json().catch(() => ({}))) as T & { error?: string };
	if (!response.ok) {
		throw new MfaRequestError(data.error ?? "Security request failed", response.status);
	}
	return data;
}

export type { MfaSetupDetails };
