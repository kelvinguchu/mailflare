ALTER TABLE `users` ADD `activation_status` text NOT NULL DEFAULT 'active'
	CHECK (`activation_status` IN ('active', 'pending', 'revoked'));
ALTER TABLE `users` ADD `activated_at` integer;
ALTER TABLE `users` ADD `invitation_sent_at` integer;
ALTER TABLE `users` ADD `invitation_expires_at` integer;

CREATE TABLE `account_recovery_tokens_next` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL CHECK (`purpose` IN ('password_reset', 'recovery_email_verification', 'account_activation')),
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL DEFAULT (unixepoch()),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

INSERT INTO `account_recovery_tokens_next`
	(`id`, `user_id`, `purpose`, `token_hash`, `email`, `expires_at`, `used_at`, `created_at`)
SELECT `id`, `user_id`, `purpose`, `token_hash`, `email`, `expires_at`, `used_at`, `created_at`
FROM `account_recovery_tokens`;

DROP TABLE `account_recovery_tokens`;
ALTER TABLE `account_recovery_tokens_next` RENAME TO `account_recovery_tokens`;

CREATE UNIQUE INDEX `account_recovery_tokens_hash_idx`
	ON `account_recovery_tokens` (`token_hash`);
CREATE INDEX `account_recovery_tokens_user_purpose_idx`
	ON `account_recovery_tokens` (`user_id`, `purpose`, `created_at`);
CREATE INDEX `account_recovery_tokens_expires_idx`
	ON `account_recovery_tokens` (`expires_at`);
