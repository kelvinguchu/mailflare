UPDATE `app_settings`
SET `app_name` = 'CaliberCode Mail', `updated_at` = unixepoch()
WHERE `id` = 'default' AND `app_name` = 'Mailflare';
