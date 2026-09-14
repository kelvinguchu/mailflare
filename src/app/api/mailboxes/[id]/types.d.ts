export type MailboxRouteParams = {
	params: Promise<{ id: string }>;
};

export type MailboxUpdateValues = {
	displayName?: string | null;
	signature?: string | null;
	signatureText?: string | null;
	signatureHtml?: string | null;
	signatureVersion?: number;
	autoReplyEnabled?: boolean;
	autoReplySubject?: string;
	autoReplyBody?: string;
	useAllDomains?: boolean;
};
