export type LoginResult = {
	redirect?: string;
	mfaRequired?: boolean;
	challengeToken?: string;
	error?: string;
};
