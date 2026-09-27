ALTER TABLE `users` ADD `mfa_policy_covered_at` integer;
ALTER TABLE `users` ADD `mfa_policy_exempt_until` integer;
ALTER TABLE `users` ADD `mfa_policy_exemption_reason` text;
ALTER TABLE `users` ADD `mfa_policy_exempted_by_user_id` text REFERENCES `users`(`id`) ON DELETE SET NULL;

CREATE INDEX `users_mfa_policy_coverage_idx`
	ON `users` (`activation_status`, `disabled`, `role`, `mfa_policy_covered_at`);

CREATE TABLE `mfa_policy_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL DEFAULT 'optional'
		CHECK (`mode` IN ('optional', 'administrators', 'all_users')),
	`grace_period_days` integer NOT NULL DEFAULT 7
		CHECK (`grace_period_days` BETWEEN 0 AND 30),
	`updated_by_user_id` text REFERENCES `users`(`id`) ON DELETE SET NULL,
	`updated_at` integer NOT NULL
);

INSERT INTO `mfa_policy_settings`
	(`id`, `mode`, `grace_period_days`, `updated_by_user_id`, `updated_at`)
VALUES ('default', 'optional', 7, NULL, unixepoch());
