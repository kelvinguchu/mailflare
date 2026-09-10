export type UserRole = "admin" | "user";

export type SessionUser = {
	id: string;
	email: string;
	resetEmail: string | null;
	resetEmailVerifiedAt: Date | null;
	forwardingEmail: string | null;
	passwordHash: string;
	name: string;
	role: UserRole;
	activationStatus: "active" | "pending" | "revoked";
	activatedAt: Date | null;
	invitationSentAt: Date | null;
	invitationExpiresAt: Date | null;
	mfaSecretEncrypted: string | null;
	mfaEnabledAt: Date | null;
	mfaRecoveryCodeHashes: string;
	mfaLastUsedCounter: number | null;
	disabled: boolean;
	canManageMailboxes: boolean;
	createdByUserId: string | null;
	createdAt: Date;
};
