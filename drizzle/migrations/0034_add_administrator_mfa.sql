ALTER TABLE `users` ADD `mfa_secret_encrypted` text;
ALTER TABLE `users` ADD `mfa_enabled_at` integer;
ALTER TABLE `users` ADD `mfa_recovery_code_hashes` text DEFAULT '[]' NOT NULL;
ALTER TABLE `users` ADD `mfa_last_used_counter` integer;

ALTER TABLE `sessions` ADD `kind` text DEFAULT 'authenticated' NOT NULL;
ALTER TABLE `sessions` ADD `authenticated_at` integer;
UPDATE `sessions` SET `authenticated_at` = `created_at` WHERE `authenticated_at` IS NULL;
CREATE INDEX `sessions_kind_expires_idx` ON `sessions` (`kind`, `expires_at`);
