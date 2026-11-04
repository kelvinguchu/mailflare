/**
 * The CaliberCode CMS's private AdvisoryScheduleService, reached through the
 * CALIBERCODE_SCHEDULE service binding (bound in production only). The CMS owns
 * advisory bookings and the time blocked from them; these routes only authorise
 * and forward.
 */

/** A paid session that sits inside a new block. The block does not cancel it. */
export type BlockConflict = { reference: string; name: string; startHour: number; endHour: number };

export type BlockResult =
	| {
			ok: true;
			block: { id: number; slotDate: string; startHour: number; endHour: number };
			conflicts: BlockConflict[];
	  }
	| { ok: false; error: string };

export type AdvisoryScheduleBinding = {
	block(input: { slotDate: string; startHour: number; endHour: number }): Promise<BlockResult>;
	unblock(input: { blockId: number }): Promise<{ ok: true } | { ok: false; error: string }>;
};

/** The account CaliberCode's calendar entries belong to. */
export const ADVISORY_OWNER_EMAIL = "mohamed@calibercode.io";

/** Blocking time changes what the public can book, so only Mohamed or an admin may. */
export function canManageAdvisory(user: { email: string; role: string }): boolean {
	return user.role === "admin" || user.email.toLowerCase() === ADVISORY_OWNER_EMAIL;
}

export function advisorySchedule(env: CloudflareEnv): AdvisoryScheduleBinding | null {
	return (
		(env as CloudflareEnv & { CALIBERCODE_SCHEDULE?: AdvisoryScheduleBinding })
			.CALIBERCODE_SCHEDULE ?? null
	);
}

export const blockEventId = (blockId: number) => `cc_block_${blockId}`;

/** Advisory hours are whole hours in Nairobi, which is UTC+03:00 all year. */
export function nairobiInstant(date: string, hour: number): Date {
	const [year, month, day] = date.split("-").map(Number);
	return new Date(Date.UTC(year, month - 1, day, hour - 3));
}
