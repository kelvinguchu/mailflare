import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { newId } from "@/lib/ids";
import { createSession, hashSessionToken } from "./session";

const TOTP_ALGORITHM = "SHA-1";
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const MFA_CHALLENGE_MINUTES = 5;
const RECOVERY_CODE_COUNT = 10;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

type MfaUser = Pick<typeof users.$inferSelect,
	"id" | "email" | "mfaSecretEncrypted" | "mfaEnabledAt" | "mfaRecoveryCodeHashes" | "mfaLastUsedCounter"
>;

export type MfaVerificationMethod = "totp" | "recovery";

export function generateTotpSecret(): string {
	return encodeBase32(randomBytes(20));
}

export function buildTotpUri(email: string, secret: string): string {
	const issuer = "CC Mail";
	const label = `${issuer}:${email}`;
	return `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

export async function encryptTotpSecret(env: CloudflareEnv, secret: string): Promise<string> {
	const key = await importEncryptionKey(env, ["encrypt"]);
	const iv = randomBytes(12);
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv: toArrayBuffer(iv) },
		key,
		new TextEncoder().encode(secret),
	);
	return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptTotpSecret(env: CloudflareEnv, encrypted: string): Promise<string> {
	const [version, encodedIv, encodedCiphertext] = encrypted.split(".");
	if (version !== "v1" || !encodedIv || !encodedCiphertext) {
		throw new Error("The stored MFA credential is invalid");
	}
	const key = await importEncryptionKey(env, ["decrypt"]);
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: toArrayBuffer(fromBase64Url(encodedIv)) },
		key,
		toArrayBuffer(fromBase64Url(encodedCiphertext)),
	);
	return new TextDecoder().decode(plaintext);
}

export async function verifyTotpCode(
	secret: string,
	code: string,
	lastUsedCounter: number | null = null,
	now = Date.now(),
): Promise<number | null> {
	const normalized = code.replace(/\s+/g, "");
	if (!/^\d{6}$/.test(normalized)) return null;
	const currentCounter = Math.floor(now / 1_000 / TOTP_PERIOD_SECONDS);
	for (const offset of [-1, 0, 1]) {
		const counter = currentCounter + offset;
		if (lastUsedCounter !== null && counter <= lastUsedCounter) continue;
		const expected = await generateTotpCode(secret, counter);
		if (await constantTimeTextEqual(expected, normalized)) return counter;
	}
	return null;
}

export async function generateRecoveryCodes(): Promise<{ codes: string[]; hashes: string[] }> {
	const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
		const raw = encodeBase32(randomBytes(10));
		return raw.match(/.{1,4}/g)!.join("-");
	});
	return { codes, hashes: await Promise.all(codes.map(hashRecoveryCode)) };
}

export async function createMfaChallenge(env: CloudflareEnv, userId: string): Promise<string> {
	const token = newId("mfa");
	const tokenHash = await hashSessionToken(token);
	const now = new Date();
	const expiresAt = new Date(now.getTime() + MFA_CHALLENGE_MINUTES * 60_000);
	const db = getDb(env);
	await db.batch([
		db.delete(sessions).where(and(
			eq(sessions.userId, userId),
			eq(sessions.kind, "mfa_challenge"),
		)),
		db.insert(sessions).values({
			id: newId(),
			userId,
			tokenHash,
			kind: "mfa_challenge",
			authenticatedAt: null,
			expiresAt,
			createdAt: now,
		}),
	]);
	return token;
}

export async function completeMfaChallenge(
	env: CloudflareEnv,
	challengeToken: string,
	code: string,
): Promise<{ token: string; userId: string; method: MfaVerificationMethod } | null> {
	const tokenHash = await hashSessionToken(challengeToken);
	const db = getDb(env);
	const [challenge] = await db.select({ id: sessions.id, userId: sessions.userId })
		.from(sessions)
		.where(and(
			eq(sessions.tokenHash, tokenHash),
			eq(sessions.kind, "mfa_challenge"),
			gt(sessions.expiresAt, new Date()),
		))
		.limit(1);
	if (!challenge) return null;

	const method = await verifyAndConsumeMfaCode(env, challenge.userId, code);
	if (!method) return null;
	const deleted = await db.delete(sessions).where(and(
		eq(sessions.id, challenge.id),
		eq(sessions.tokenHash, tokenHash),
		eq(sessions.kind, "mfa_challenge"),
	));
	if (deleted.meta.changes !== 1) return null;
	return { token: await createSession(env, challenge.userId), userId: challenge.userId, method };
}

export async function verifyAndConsumeMfaCode(
	env: CloudflareEnv,
	userId: string,
	code: string,
): Promise<MfaVerificationMethod | null> {
	const db = getDb(env);
	const [user] = await db.select({
		id: users.id,
		email: users.email,
		mfaSecretEncrypted: users.mfaSecretEncrypted,
		mfaEnabledAt: users.mfaEnabledAt,
		mfaRecoveryCodeHashes: users.mfaRecoveryCodeHashes,
		mfaLastUsedCounter: users.mfaLastUsedCounter,
	}).from(users).where(eq(users.id, userId)).limit(1);
	if (!isMfaEnabled(user)) return null;

	const secret = await decryptTotpSecret(env, user.mfaSecretEncrypted);
	const counter = await verifyTotpCode(secret, code, user.mfaLastUsedCounter);
	if (counter !== null) {
		const result = await db.update(users).set({ mfaLastUsedCounter: counter }).where(and(
			eq(users.id, user.id),
			or(isNull(users.mfaLastUsedCounter), lt(users.mfaLastUsedCounter, counter)),
		));
		return result.meta.changes === 1 ? "totp" : null;
	}

	const normalized = normalizeRecoveryCode(code);
	if (!/^[A-Z2-7]{16}$/.test(normalized)) return null;
	const hashes = parseRecoveryHashes(user.mfaRecoveryCodeHashes);
	const candidate = await hashRecoveryCode(normalized);
	const matchIndex = await findConstantTimeMatch(hashes, candidate);
	if (matchIndex < 0) return null;
	const nextHashes = hashes.filter((_, index) => index !== matchIndex);
	const result = await db.update(users).set({
		mfaRecoveryCodeHashes: JSON.stringify(nextHashes),
	}).where(and(
		eq(users.id, user.id),
		eq(users.mfaRecoveryCodeHashes, user.mfaRecoveryCodeHashes),
	));
	return result.meta.changes === 1 ? "recovery" : null;
}

export function isMfaEnabled(user: MfaUser | undefined): user is MfaUser & {
	mfaSecretEncrypted: string;
	mfaEnabledAt: Date;
} {
	return !!user?.mfaSecretEncrypted && !!user.mfaEnabledAt;
}

async function generateTotpCode(secret: string, counter: number): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		toArrayBuffer(decodeBase32(secret)),
		{ name: "HMAC", hash: TOTP_ALGORITHM },
		false,
		["sign"],
	);
	const counterBytes = new Uint8Array(8);
	let remaining = BigInt(counter);
	for (let index = counterBytes.length - 1; index >= 0; index -= 1) {
		counterBytes[index] = Number(remaining & 0xffn);
		remaining >>= 8n;
	}
	const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, toArrayBuffer(counterBytes)));
	const offset = signature[signature.length - 1]! & 0x0f;
	const binary = ((signature[offset]! & 0x7f) << 24)
		| ((signature[offset + 1]! & 0xff) << 16)
		| ((signature[offset + 2]! & 0xff) << 8)
		| (signature[offset + 3]! & 0xff);
	return (binary % (10 ** TOTP_DIGITS)).toString().padStart(TOTP_DIGITS, "0");
}

async function importEncryptionKey(env: CloudflareEnv, usages: KeyUsage[]): Promise<CryptoKey> {
	const value = "MFA_ENCRYPTION_KEY" in env
		? (env as CloudflareEnv & { MFA_ENCRYPTION_KEY?: unknown }).MFA_ENCRYPTION_KEY
		: undefined;
	if (typeof value !== "string") throw new Error("MFA encryption is not configured");
	const bytes = fromBase64Url(value);
	if (bytes.byteLength !== 32) throw new Error("MFA encryption is not configured correctly");
	return crypto.subtle.importKey("raw", toArrayBuffer(bytes), "AES-GCM", false, usages);
}

function parseRecoveryHashes(value: string): string[] {
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string") ? parsed : [];
	} catch {
		return [];
	}
}

function normalizeRecoveryCode(value: string): string {
	return value.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

async function hashRecoveryCode(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeRecoveryCode(value)));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function findConstantTimeMatch(values: string[], candidate: string): Promise<number> {
	let match = -1;
	for (let index = 0; index < values.length; index += 1) {
		if (await constantTimeTextEqual(values[index]!, candidate)) match = index;
	}
	return match;
}

async function constantTimeTextEqual(left: string, right: string): Promise<boolean> {
	const [leftHash, rightHash] = await Promise.all([
		crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
		crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
	]);
	const leftBytes = new Uint8Array(leftHash);
	const rightBytes = new Uint8Array(rightHash);
	let difference = 0;
	for (let index = 0; index < leftBytes.length; index += 1) {
		difference |= leftBytes[index]! ^ rightBytes[index]!;
	}
	return difference === 0;
}

function randomBytes(length: number): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(length));
}

function encodeBase32(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let output = "";
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
	return output;
}

function decodeBase32(value: string): Uint8Array {
	let bits = 0;
	let buffer = 0;
	const output: number[] = [];
	for (const character of value.toUpperCase().replace(/=+$/g, "")) {
		const index = BASE32_ALPHABET.indexOf(character);
		if (index < 0) throw new Error("Invalid TOTP secret");
		buffer = (buffer << 5) | index;
		bits += 5;
		if (bits >= 8) {
			output.push((buffer >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}
	return new Uint8Array(output);
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
	const binary = atob(padded);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}
