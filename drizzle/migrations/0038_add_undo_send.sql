ALTER TABLE outbound_jobs ADD COLUMN send_not_before integer;
--> statement-breakpoint
ALTER TABLE outbound_jobs ADD COLUMN canceled_at integer;
--> statement-breakpoint
CREATE INDEX outbound_jobs_status_send_not_before_idx
	ON outbound_jobs (status, send_not_before);
