UPDATE `app_settings`
SET `app_name` = 'CC Mail', `updated_at` = unixepoch()
WHERE `id` = 'default' AND `app_name` IN ('Mailflare', 'CaliberCode Mail');
