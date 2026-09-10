export type ManagedAccount = {
	id: string;
	email: string;
	name: string;
	role: "admin" | "user";
	resetEmail: string | null;
	activationStatus: "active" | "pending" | "revoked";
	activatedAt: string | null;
	invitationSentAt: string | null;
	invitationExpiresAt: string | null;
	invitationExpired: boolean;
	disabled: boolean;
	canManageMailboxes: boolean;
	sendRateLimitPerMinute: number;
	dailySendLimit: number;
	activeSessionCount: number;
	forwardingEmail: string | null;
	hasAvatar: boolean;
};

export type ManagedMailbox = {
	id: string;
	localPart: string;
	displayName: string | null;
	domainId: string;
	hostname: string;
};

export type ManagedDomain = { id: string; hostname: string };

export type ManagedAccountResponse = {
	account?: ManagedAccount;
	error?: string;
};

export type AccountDetail = ManagedAccount;
export type DomainOption = ManagedDomain;
export type AccountMailboxItem = ManagedMailbox;

export type AccountDetailResponse = ManagedAccountResponse;
