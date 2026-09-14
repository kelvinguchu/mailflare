export const UNDO_SEND_DELAY_SECONDS = [5, 10, 20, 30] as const;
export const DEFAULT_UNDO_SEND_DELAY_SECONDS = 10;

export type UndoSendResult =
	| { outcome: "canceled"; jobId: string; messageId: string }
	| {
			outcome: "unavailable";
			jobId: string;
			status: string;
			undoDeadline: string | null;
	  }
	| { outcome: "not_found" };

export function parseUndoSendDelay(value: string | null): number {
	const parsed = Number(value);
	return UNDO_SEND_DELAY_SECONDS.some((seconds) => seconds === parsed)
		? parsed
		: DEFAULT_UNDO_SEND_DELAY_SECONDS;
}

export async function cancelScheduledOutboundJob(
	env: CloudflareEnv,
	userId: string,
	jobId: string,
	now = new Date(),
): Promise<UndoSendResult> {
	const nowSeconds = Math.floor(now.getTime() / 1_000);
	const statements = await env.DB.batch([
		env.DB.prepare(
			`UPDATE outbound_jobs
			 SET status = 'canceled', canceled_at = ?, error = NULL, updated_at = ?
			 WHERE id = ? AND user_id = ? AND status = 'scheduled'
			   AND delivery_started_at IS NULL AND send_not_before > ?`,
		).bind(nowSeconds, nowSeconds, jobId, userId, nowSeconds),
		env.DB.prepare(
			`UPDATE messages
			 SET status = 'canceled', delivery_status = 'canceled',
			     delivery_detail = 'Canceled during the Undo Send window', delivery_updated_at = ?
			 WHERE id = (
			   SELECT message_id FROM outbound_jobs
			   WHERE id = ? AND user_id = ? AND status = 'canceled'
			 )`,
		).bind(nowSeconds, jobId, userId),
	]);

	const changed = statements[0]?.meta.changes ?? 0;
	const job = await env.DB.prepare(
		"SELECT message_id, status, send_not_before FROM outbound_jobs WHERE id = ? AND user_id = ?",
	)
		.bind(jobId, userId)
		.first<{ message_id: string | null; status: string; send_not_before: number | null }>();
	if (!job) return { outcome: "not_found" };
	if ((changed === 1 || job.status === "canceled") && job.message_id) {
		return { outcome: "canceled", jobId, messageId: job.message_id };
	}
	return {
		outcome: "unavailable",
		jobId,
		status: job.status,
		undoDeadline: job.send_not_before ? new Date(job.send_not_before * 1_000).toISOString() : null,
	};
}
