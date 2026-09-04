ALTER TABLE `outbound_jobs` ADD COLUMN `idempotency_key` text;
ALTER TABLE `outbound_jobs` ADD COLUMN `request_hash` text;
ALTER TABLE `outbound_jobs` ADD COLUMN `delivery_started_at` integer;
ALTER TABLE `outbound_jobs` ADD COLUMN `attempt_count` integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX `outbound_jobs_user_idempotency_key_idx`
ON `outbound_jobs` (`user_id`, `idempotency_key`);
