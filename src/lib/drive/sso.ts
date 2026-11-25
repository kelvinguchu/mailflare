/**
 * Sign-in to CaliberCode Drive with a Mailflare account (drive AGENTS.md A6).
 *
 * The drive sends the browser to /sso/drive with a random `state`. Once the user is signed in
 * here, we make a one-time code bound to that state and send the browser back to the drive,
 * which redeems the code over the private DriveAuthService binding. Codes are stored hashed,
 * live 60 seconds and work once; a leaked code is useless without the matching state.
 */

const CODE_TTL_SECONDS = 60;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type DriveUser = {
	id: string;
	email: string;
	name: string;
	role: "admin" | "user";
	avatarKey: string | null;
};

export type DriveUserStatus = { active: boolean; role: "admin" | "user" };

/** The drive's state: 32 random bytes in base64url. */
export function isValidDriveState(state: unknown): state is string {
	return typeof state === "string" && STATE_PATTERN.test(state);
}

/**
 * The drive origins Mailflare may send sign-in codes to, from DRIVE_ORIGINS (comma-separated,
 * for example the production and staging drives). Anything that isn't a bare https origin is
 * ignored.
 */
export function allowedDriveOrigins(value: string | undefined): string[] {
	const origins: string[] = [];
	for (const entry of (value ?? "").split(",")) {
		const candidate = entry.trim();
		if (!candidate) continue;
		try {
			const url = new URL(candidate);
			if (url.protocol === "https:" && url.origin === candidate) origins.push(url.origin);
		} catch {
			// Not a URL: ignored.
		}
	}
	return origins;
}

/** The requested drive origin, only when it is exactly one of the allowed ones. */
export function pickDriveOrigin(requested: unknown, allowed: readonly string[]): string | null {
	return typeof requested === "string" && allowed.includes(requested) ? requested : null;
}

/** The /sso/drive path the login page returns to. */
export function driveSsoPath(state: string, driveOrigin: string): string {
	return `/sso/drive?${new URLSearchParams({ state, drive: driveOrigin }).toString()}`;
}

/**
 * The only return path the login page accepts: back to /sso/drive with a valid state and an
 * allowed drive, and nothing else, so `next` can't be used as an open redirect.
 */
export function safeDriveNext(next: unknown, allowed: readonly string[]): string | null {
	if (typeof next !== "string" || !next.startsWith("/sso/drive?")) return null;
	const base = "https://mailflare.invalid";
	let url: URL;
	try {
		url = new URL(next, base);
	} catch {
		return null;
	}
	if (url.origin !== base || url.pathname !== "/sso/drive") return null;
	const keys = [...url.searchParams.keys()].sort();
	if (keys.length !== 2 || keys[0] !== "drive" || keys[1] !== "state") return null;
	const state = url.searchParams.get("state");
	const driveOrigin = pickDriveOrigin(url.searchParams.get("drive"), allowed);
	if (!isValidDriveState(state) || !driveOrigin) return null;
	return driveSsoPath(state, driveOrigin);
}

function base64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** Makes a one-time code for `userId`, bound to the drive's `state`. */
export async function createDriveSsoCode(
	env: Pick<CloudflareEnv, "DB">,
	userId: string,
	state: string,
	now = new Date(),
): Promise<string> {
	if (!isValidDriveState(state)) throw new Error("Invalid drive state");
	const code = base64Url(crypto.getRandomValues(new Uint8Array(32)));
	await env.DB.prepare(
		`INSERT INTO drive_sso_codes (code_hash, state_hash, user_id, expires_at, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
	)
		.bind(await sha256Hex(code), await sha256Hex(state), userId, seconds(now) + CODE_TTL_SECONDS, seconds(now))
		.run();
	return code;
}

/** The drive's callback URL carrying the code and state. */
export function driveCallbackUrl(driveOrigin: string, code: string, state: string): string {
	const url = new URL("/auth/callback", new URL(driveOrigin).origin);
	url.searchParams.set("code", code);
	url.searchParams.set("state", state);
	return url.toString();
}

const ACTIVE_USER = `disabled = 0 AND activation_status = 'active' AND archived_at IS NULL`;

/**
 * Redeems a code once. Returns the user only when the code exists, matches the state, hasn't
 * expired or been used, and the user is still active; otherwise null.
 */
export async function redeemDriveSsoCode(
	env: Pick<CloudflareEnv, "DB">,
	code: unknown,
	state: unknown,
	now = new Date(),
): Promise<DriveUser | null> {
	if (typeof code !== "string" || !CODE_PATTERN.test(code) || !isValidDriveState(state)) return null;
	// One statement marks the code used and returns it, so two redemptions can't both succeed.
	const used = await env.DB.prepare(
		`UPDATE drive_sso_codes SET used_at = ?
		 WHERE code_hash = ? AND state_hash = ? AND used_at IS NULL AND expires_at > ?
		 RETURNING user_id`,
	)
		.bind(seconds(now), await sha256Hex(code), await sha256Hex(state), seconds(now))
		.first<{ user_id: string }>();
	if (!used) return null;
	const user = await env.DB.prepare(
		`SELECT id, email, name, role, avatar_key FROM users WHERE id = ? AND ${ACTIVE_USER}`,
	)
		.bind(used.user_id)
		.first<{ id: string; email: string; name: string | null; role: string; avatar_key: string | null }>();
	if (!user) return null;
	return {
		id: user.id,
		email: user.email,
		name: user.name?.trim() || user.email,
		role: user.role === "admin" ? "admin" : "user",
		avatarKey: user.avatar_key,
	};
}

/** Whether a Mailflare user may still use the drive, and their current role. */
export async function checkDriveUser(env: Pick<CloudflareEnv, "DB">, userId: unknown): Promise<DriveUserStatus> {
	if (typeof userId !== "string" || userId.length === 0 || userId.length > 100) {
		return { active: false, role: "user" };
	}
	const user = await env.DB.prepare(`SELECT role, (${ACTIVE_USER}) AS active FROM users WHERE id = ?`)
		.bind(userId)
		.first<{ role: string; active: number }>();
	return { active: user?.active === 1, role: user?.role === "admin" ? "admin" : "user" };
}

/** Removes codes that expired more than a day ago. Runs from the daily cleanup. */
export async function deleteExpiredDriveSsoCodes(env: Pick<CloudflareEnv, "DB">, now = new Date()): Promise<number> {
	const result = await env.DB.prepare("DELETE FROM drive_sso_codes WHERE expires_at < ?")
		.bind(seconds(now) - 24 * 60 * 60)
		.run();
	return result.meta.changes;
}
