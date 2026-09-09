CREATE INDEX `sessions_user_expires_idx` ON `sessions` (`user_id`, `expires_at`);
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);
CREATE INDEX `audit_logs_target_action_created_idx`
	ON `audit_logs` (`target_user_id`, `action`, `created_at`);
