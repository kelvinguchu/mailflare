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
	disabled: boolean;
	canManageMailboxes: boolean;
	createdByUserId: string | null;
	createdAt: Date;
};
