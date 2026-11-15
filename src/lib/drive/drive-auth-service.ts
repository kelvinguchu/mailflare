import { WorkerEntrypoint } from "cloudflare:workers";
import { checkDriveUser, redeemDriveSsoCode, type DriveUser, type DriveUserStatus } from "./sso";

/**
 * Private service-binding API for CaliberCode Drive (drive AGENTS.md A13). There is no public
 * HTTP endpoint; only the drive's Worker, through its MAILFLARE_AUTH binding, can call it.
 */
export class DriveAuthService extends WorkerEntrypoint<CloudflareEnv> {
	/** Redeems a one-time sign-in code made by /sso/drive. Null when it can't be used. */
	async redeem(code: string, state: string): Promise<DriveUser | null> {
		return redeemDriveSsoCode(this.env, code, state);
	}

	/** Whether the user may still use the drive, and their role. The drive calls this every few minutes. */
	async checkUser(mailflareUserId: string): Promise<DriveUserStatus> {
		return checkDriveUser(this.env, mailflareUserId);
	}
}
