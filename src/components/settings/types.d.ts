export type ProfileFormProps = {
	initialName: string;
	initialResetEmail: string;
	initialResetEmailVerified: boolean;
	email: string;
};

export type ProfileFormResponse = {
	user?: {
		name: string;
		resetEmail: string | null;
		resetEmailVerified: boolean;
		forwardingEmail: string | null;
	};
	error?: unknown;
};

export type AccountSettingsResponse = {
	user?: {
		email: string;
		name: string;
		resetEmail: string | null;
		resetEmailVerified: boolean;
		forwardingEmail: string | null;
		role: "admin" | "user";
		mfaEnabled: boolean;
	};
	error?: unknown;
};

export type ForwardingEmailFormProps = {
	initialForwardingEmail: string;
};

export type ForwardingEmailResponse = {
	forwardingEmail?: string | null;
	error?: unknown;
};

export type MailboxSignatureResponse = {
	mailbox?: {
		id: string;
		localPart: string;
		hostname: string;
		displayName: string | null;
		signature: string | null;
		signatureText?: string | null;
		signatureHtml?: string | null;
		signatureVersion?: number;
		hasAvatar?: boolean;
		isPrimary?: boolean;
	};
	error?: unknown;
};

export type MailboxSignatureValue = {
	signature: string | null;
	signatureText: string | null;
	signatureHtml: string | null;
	signatureVersion: number;
};

export type SignatureAsset = {
	id: string;
	mailboxId: string;
	contentId: string;
	src: string;
	previewUrl: string;
	filename: string;
	type: string;
	size: number;
	width: number;
	height: number;
	altText: string;
	createdAt: string;
};

export type SignatureAssetsResponse = {
	assets?: SignatureAsset[];
	asset?: SignatureAsset;
	error?: unknown;
};

export type MailboxAutoReplySettings = {
	enabled: boolean;
	subject: string;
	body: string;
};

export type MailboxAutoReplyResponse = {
	mailbox?: {
		autoReplyEnabled: boolean;
		autoReplySubject: string;
		autoReplyBody: string;
	};
	error?: unknown;
};

export type ChangePasswordResponse = {
	revokedSessions?: number;
	error?: unknown;
};

export type RecentSignIn = {
	id: string;
	createdAt: string;
	ipAddress: string;
	city: string | null;
	country: string | null;
	device: string;
	platform: string;
};

export type SessionManagementResponse = {
	activeSessionCount?: number;
	currentSession?: { createdAt: string; expiresAt: string } | null;
	recentSignIns?: RecentSignIn[];
	revokedSessions?: number;
	error?: unknown;
};

export type ProfileAvatarSessionResponse = {
	user?: {
		hasAvatar?: boolean;
	};
};

export type ProfileAvatarUploadResponse = {
	error?: string;
};

export type ProfileAvatarFormProps = {
	mailboxId?: string;
	initialHasAvatar?: boolean;
	name?: string;
};

export type CurrentMailboxFormResponse = {
	mailbox?: {
		id: string;
		localPart: string;
		hostname: string;
		displayName: string | null;
		signature?: string | null;
		signatureText?: string | null;
		signatureHtml?: string | null;
		signatureVersion?: number;
		hasAvatar?: boolean;
		isPrimary?: boolean;
	};
	error?: unknown;
};

export type MfaPolicyState = "not_required" | "compliant" | "grace" | "exempt" | "restricted";

export type MfaStatus = {
	enabled: boolean;
	recoveryCodesRemaining: number;
	policy: {
		state: MfaPolicyState;
		required: boolean;
		deadline: string | null;
		exemptUntil: string | null;
	};
};

export type MfaSetupDetails = { secret: string; otpauthUri: string };

export type MfaRequestContext = "begin" | "verify" | "protected" | "status";
