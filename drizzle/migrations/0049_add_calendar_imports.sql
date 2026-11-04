ALTER TABLE calendar_events ADD COLUMN import_uid text;
ALTER TABLE calendar_events ADD COLUMN import_organizer text;
ALTER TABLE calendar_events ADD COLUMN import_cancelled integer DEFAULT 0 NOT NULL;
CREATE UNIQUE INDEX calendar_events_import_identity_idx ON calendar_events(user_id, import_uid, import_organizer);
