DROP TRIGGER IF EXISTS message_search_after_insert;
DROP TRIGGER IF EXISTS message_search_after_delete;
DROP TRIGGER IF EXISTS message_search_after_update;
DROP TRIGGER IF EXISTS message_search_attachment_after_insert;
DROP TRIGGER IF EXISTS message_search_attachment_after_delete;
DROP TRIGGER IF EXISTS message_search_attachment_after_update;
DROP TABLE IF EXISTS message_search;

CREATE VIRTUAL TABLE message_search USING fts5(
  message_id UNINDEXED,
  sender,
  recipients,
  subject,
  snippet,
  body,
  attachment_names,
  tokenize = 'trigram'
);

INSERT INTO message_search (
  rowid,
  message_id,
  sender,
  recipients,
  subject,
  snippet,
  body,
  attachment_names
)
SELECT
  messages.rowid,
  messages.id,
  messages.from_addr,
  messages.to_addr,
  coalesce(messages.subject, ''),
  coalesce(messages.snippet, ''),
  coalesce(messages.text_body, '') || ' ' || coalesce(messages.html_body, ''),
  coalesce((
    SELECT group_concat(message_attachments.filename, ' ')
    FROM message_attachments
    WHERE message_attachments.message_id = messages.id
  ), '')
FROM messages;

CREATE TRIGGER message_search_after_insert
AFTER INSERT ON messages
BEGIN
  INSERT INTO message_search (
    rowid,
    message_id,
    sender,
    recipients,
    subject,
    snippet,
    body,
    attachment_names
  ) VALUES (
    new.rowid,
    new.id,
    new.from_addr,
    new.to_addr,
    coalesce(new.subject, ''),
    coalesce(new.snippet, ''),
    coalesce(new.text_body, '') || ' ' || coalesce(new.html_body, ''),
    ''
  );
END;

CREATE TRIGGER message_search_after_delete
AFTER DELETE ON messages
BEGIN
  DELETE FROM message_search WHERE rowid = old.rowid;
END;

CREATE TRIGGER message_search_after_update
AFTER UPDATE OF id, from_addr, to_addr, subject, snippet, text_body, html_body ON messages
BEGIN
  DELETE FROM message_search WHERE rowid = old.rowid;
  INSERT INTO message_search (
    rowid,
    message_id,
    sender,
    recipients,
    subject,
    snippet,
    body,
    attachment_names
  )
  SELECT
    new.rowid,
    new.id,
    new.from_addr,
    new.to_addr,
    coalesce(new.subject, ''),
    coalesce(new.snippet, ''),
    coalesce(new.text_body, '') || ' ' || coalesce(new.html_body, ''),
    coalesce((
      SELECT group_concat(message_attachments.filename, ' ')
      FROM message_attachments
      WHERE message_attachments.message_id = new.id
    ), '');
END;

CREATE TRIGGER message_search_attachment_after_insert
AFTER INSERT ON message_attachments
BEGIN
  UPDATE message_search
  SET attachment_names = coalesce((
    SELECT group_concat(message_attachments.filename, ' ')
    FROM message_attachments
    WHERE message_attachments.message_id = new.message_id
  ), '')
  WHERE rowid = (SELECT rowid FROM messages WHERE id = new.message_id);
END;

CREATE TRIGGER message_search_attachment_after_delete
AFTER DELETE ON message_attachments
BEGIN
  UPDATE message_search
  SET attachment_names = coalesce((
    SELECT group_concat(message_attachments.filename, ' ')
    FROM message_attachments
    WHERE message_attachments.message_id = old.message_id
  ), '')
  WHERE rowid = (SELECT rowid FROM messages WHERE id = old.message_id);
END;

CREATE TRIGGER message_search_attachment_after_update
AFTER UPDATE OF message_id, filename ON message_attachments
BEGIN
  UPDATE message_search
  SET attachment_names = coalesce((
    SELECT group_concat(message_attachments.filename, ' ')
    FROM message_attachments
    WHERE message_attachments.message_id = old.message_id
  ), '')
  WHERE rowid = (SELECT rowid FROM messages WHERE id = old.message_id);

  UPDATE message_search
  SET attachment_names = coalesce((
    SELECT group_concat(message_attachments.filename, ' ')
    FROM message_attachments
    WHERE message_attachments.message_id = new.message_id
  ), '')
  WHERE rowid = (SELECT rowid FROM messages WHERE id = new.message_id);
END;

INSERT INTO message_search(message_search) VALUES('optimize');
PRAGMA optimize;
