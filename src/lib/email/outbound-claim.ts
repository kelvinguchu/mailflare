export async function claimOutboundDelivery(
	db: Pick<D1Database, "prepare">,
	jobId: string,
): Promise<boolean> {
	const result = await db
		.prepare(`
			UPDATE outbound_jobs
			SET status = 'sending',
				delivery_started_at = unixepoch(),
				attempt_count = attempt_count + 1,
				error = NULL,
				updated_at = unixepoch()
			WHERE id = ?
				AND status = 'queued'
				AND delivery_started_at IS NULL
		`)
		.bind(jobId)
		.run();
	return result.meta.changes === 1;
}
