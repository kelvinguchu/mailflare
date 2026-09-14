export async function claimOutboundDelivery(
	db: Pick<D1Database, "prepare">,
	jobId: string,
	now = new Date(),
): Promise<boolean> {
	const nowSeconds = Math.floor(now.getTime() / 1_000);
	const result = await db
		.prepare(
			`
			UPDATE outbound_jobs
			SET status = 'sending',
				delivery_started_at = ?,
				attempt_count = attempt_count + 1,
				error = NULL,
				updated_at = ?
			WHERE id = ?
				AND (
					status = 'queued'
					OR (status = 'scheduled' AND send_not_before <= ?)
				)
				AND delivery_started_at IS NULL
		`,
		)
		.bind(nowSeconds, nowSeconds, jobId, nowSeconds)
		.run();
	return result.meta.changes === 1;
}
