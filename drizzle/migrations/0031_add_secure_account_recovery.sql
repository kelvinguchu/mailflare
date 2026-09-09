ALTER TABLE `users` ADD `reset_email_verified_at` integer;

CREATE TABLE `account_recovery_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL CHECK (`purpose` IN ('password_reset', 'recovery_email_verification')),
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL DEFAULT (unixepoch()),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `account_recovery_tokens_hash_idx`
	ON `account_recovery_tokens` (`token_hash`);
CREATE INDEX `account_recovery_tokens_user_purpose_idx`
	ON `account_recovery_tokens` (`user_id`, `purpose`, `created_at`);
CREATE INDEX `account_recovery_tokens_expires_idx`
	ON `account_recovery_tokens` (`expires_at`);
