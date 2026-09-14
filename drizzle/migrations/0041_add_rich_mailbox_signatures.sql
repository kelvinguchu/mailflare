ALTER TABLE `mailboxes` ADD `signature_text` text;
--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `signature_html` text;
--> statement-breakpoint
ALTER TABLE `mailboxes` ADD `signature_version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
UPDATE `mailboxes` SET `signature_text` = `signature` WHERE `signature` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `signature_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`uploaded_by_user_id` text,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`alt_text` text DEFAULT '' NOT NULL,
	`content_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signature_assets_content_id_idx` ON `signature_assets` (`content_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `signature_assets_r2_key_idx` ON `signature_assets` (`r2_key`);
--> statement-breakpoint
CREATE INDEX `signature_assets_mailbox_idx` ON `signature_assets` (`mailbox_id`);
