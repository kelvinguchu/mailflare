ALTER TABLE messages ADD COLUMN employee_hidden_at integer;
ALTER TABLE messages ADD COLUMN deletion_original_status text;
ALTER TABLE messages ADD COLUMN deletion_original_folder_id text;
ALTER TABLE messages ADD COLUMN deletion_original_folder_name text;
ALTER TABLE messages ADD COLUMN original_user_id text;
ALTER TABLE messages ADD COLUMN original_user_email text;
ALTER TABLE messages ADD COLUMN original_mailbox_id text;
ALTER TABLE messages ADD COLUMN original_mailbox_address text;
ALTER TABLE messages ADD COLUMN original_mailbox_type text;
ALTER TABLE messages ADD COLUMN draft_revision integer NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN consumed_by_message_id text;
CREATE TABLE message_deletion_events (
 id text PRIMARY KEY NOT NULL,
 message_id text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 actor_user_id text, actor_email text, action text NOT NULL,
 from_status text, from_folder_name text, created_at integer NOT NULL
);
CREATE INDEX message_deletion_events_message_idx ON message_deletion_events(message_id, created_at);
CREATE INDEX messages_employee_visible_idx ON messages(mailbox_id, employee_hidden_at, created_at DESC, id DESC);
UPDATE messages SET original_user_id = user_id,
 original_user_email = (SELECT email FROM users WHERE id = messages.user_id),
 original_mailbox_id = mailbox_id,
 original_mailbox_address = (SELECT local_part || '@' || hostname FROM mailboxes JOIN domains ON domain_id = domains.id WHERE mailboxes.id = messages.mailbox_id),
 original_mailbox_type = (SELECT type FROM mailboxes WHERE id = messages.mailbox_id);
INSERT INTO message_deletion_events (id, message_id, action, created_at)
 SELECT 'legacy_' || id, id, 'historical_trash', coalesce(trashed_at, created_at) FROM messages WHERE status = 'trash';
CREATE TRIGGER messages_record_origin AFTER INSERT ON messages
BEGIN
 UPDATE messages SET original_user_id = coalesce(new.original_user_id, new.user_id),
 original_user_email = coalesce(new.original_user_email, (SELECT email FROM users WHERE id = new.user_id)),
 original_mailbox_id = coalesce(new.original_mailbox_id, new.mailbox_id),
 original_mailbox_address = coalesce(new.original_mailbox_address, (SELECT local_part || '@' || hostname FROM mailboxes JOIN domains ON domain_id = domains.id WHERE mailboxes.id = new.mailbox_id)),
 original_mailbox_type = coalesce(new.original_mailbox_type, (SELECT type FROM mailboxes WHERE id = new.mailbox_id)) WHERE id = new.id;
END;
CREATE TRIGGER messages_record_pretrash AFTER UPDATE OF status ON messages
WHEN new.status = 'trash' AND old.status <> 'trash'
BEGIN
 UPDATE messages SET deletion_original_status = old.status, deletion_original_folder_id = old.folder_id,
 deletion_original_folder_name = (SELECT name FROM folders WHERE id = old.folder_id) WHERE id = new.id;
END;

ALTER TABLE storage_deletion_jobs ADD COLUMN owner_authorized_at integer;

ALTER TABLE messages ADD COLUMN draft_save_token text;

UPDATE messages SET original_user_id = (SELECT id FROM users WHERE lower(email) = lower(messages.original_mailbox_address) LIMIT 1), original_user_email = (SELECT email FROM users WHERE lower(email) = lower(messages.original_mailbox_address) LIMIT 1) WHERE original_mailbox_type = 'personal' AND EXISTS (SELECT 1 FROM users WHERE lower(email) = lower(messages.original_mailbox_address) AND archived_at IS NOT NULL);
CREATE INDEX messages_original_mailbox_created_idx ON messages(original_mailbox_id, created_at DESC, id DESC);
