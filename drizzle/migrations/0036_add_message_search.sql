CREATE VIRTUAL TABLE message_search USING fts5(
  message_id UNINDEXED,
  search_text,
  subject,
  tokenize = 'trigram'
);

INSERT INTO message_search (message_id, search_text, subject)
SELECT
  id,
  from_addr || ' ' || to_addr || ' ' || coalesce(subject, '') || ' ' || coalesce(snippet, ''),
  coalesce(subject, '')
FROM messages;

CREATE TRIGGER message_search_after_insert
AFTER INSERT ON messages
BEGIN
  INSERT INTO message_search (message_id, search_text, subject)
  VALUES (
    new.id,
    new.from_addr || ' ' || new.to_addr || ' ' || coalesce(new.subject, '') || ' ' || coalesce(new.snippet, ''),
    coalesce(new.subject, '')
  );
END;

CREATE TRIGGER message_search_after_delete
AFTER DELETE ON messages
BEGIN
  DELETE FROM message_search WHERE message_id = old.id;
END;

CREATE TRIGGER message_search_after_update
AFTER UPDATE OF id, from_addr, to_addr, subject, snippet ON messages
BEGIN
  DELETE FROM message_search WHERE message_id = old.id;
  INSERT INTO message_search (message_id, search_text, subject)
  VALUES (
    new.id,
    new.from_addr || ' ' || new.to_addr || ' ' || coalesce(new.subject, '') || ' ' || coalesce(new.snippet, ''),
    coalesce(new.subject, '')
  );
END;
