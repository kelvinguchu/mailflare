export type Domain = {
	id: string;
	hostname: string;
};

export type Account = {
	id: string;
	email: string;
	name: string;
	resetEmail: string | null;
	role: "admin" | "user";
	activationStatus: "active" | "pending" | "revoked";
	activatedAt: string | null;
	invitationSentAt: string | null;
	invitationExpiresAt: string | null;
	invitationExpired: boolean;
	disabled?: boolean;
	hasAvatar?: boolean;
	canManageMailboxes?: boolean;
	createdAt: string;
	mailboxId?: string | null;
	localPart?: string | null;
	hostname?: string | null;
};

export type AccountResponse = {
	accounts?: Account[];
	account?: Account;
	invitationDelivery?: "pending" | "delivery_disabled";
	error?: string;
};
