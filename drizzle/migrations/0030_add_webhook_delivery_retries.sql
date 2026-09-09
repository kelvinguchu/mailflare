ALTER TABLE `webhook_deliveries` ADD `last_attempt_at` integer;
ALTER TABLE `webhook_deliveries` ADD `next_attempt_at` integer;
ALTER TABLE `webhook_deliveries` ADD `delivered_at` integer;
ALTER TABLE `webhook_deliveries` ADD `last_status_code` integer;
ALTER TABLE `webhook_deliveries` ADD `last_error` text;
CREATE INDEX `webhook_deliveries_webhook_created_idx`
	ON `webhook_deliveries` (`webhook_id`, `created_at`);
CREATE INDEX `webhook_deliveries_status_next_idx`
	ON `webhook_deliveries` (`status`, `next_attempt_at`);
