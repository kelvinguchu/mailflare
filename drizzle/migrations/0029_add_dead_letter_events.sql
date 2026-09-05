CREATE TABLE `dead_letter_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_queue` text NOT NULL,
	`dead_letter_queue` text NOT NULL,
	`queue_message_id` text NOT NULL,
	`reference_id` text,
	`payload` text NOT NULL,
	`diagnostic_code` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`status` text DEFAULT 'unresolved' NOT NULL,
	`replay_count` integer DEFAULT 0 NOT NULL,
	`message_created_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`replayed_at` integer,
	`replayed_by_user_id` text,
	FOREIGN KEY (`replayed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `dead_letter_events_queue_message_idx`
	ON `dead_letter_events` (`dead_letter_queue`, `queue_message_id`);
CREATE INDEX `dead_letter_events_status_created_idx`
	ON `dead_letter_events` (`status`, `created_at`);
CREATE INDEX `dead_letter_events_source_created_idx`
	ON `dead_letter_events` (`source_queue`, `created_at`);
