ALTER TABLE users ADD COLUMN send_rate_limit_per_minute integer DEFAULT 20 NOT NULL;
ALTER TABLE users ADD COLUMN daily_send_limit integer DEFAULT 500 NOT NULL;
ALTER TABLE domains ADD COLUMN send_rate_limit_per_minute integer DEFAULT 60 NOT NULL;
ALTER TABLE domains ADD COLUMN daily_send_limit integer DEFAULT 2000 NOT NULL;
ALTER TABLE messages ADD COLUMN delivery_status text;
ALTER TABLE messages ADD COLUMN delivery_detail text;
ALTER TABLE messages ADD COLUMN delivery_updated_at integer;
ALTER TABLE messages ADD COLUMN security_status text DEFAULT 'clean' NOT NULL;
ALTER TABLE messages ADD COLUMN security_reason text;
ALTER TABLE messages ADD COLUMN spam_score integer DEFAULT 0 NOT NULL;
ALTER TABLE message_attachments ADD COLUMN security_status text DEFAULT 'safe' NOT NULL;
ALTER TABLE message_attachments ADD COLUMN security_reason text;
ALTER TABLE outbound_jobs ADD COLUMN domain_id text REFERENCES domains(id) ON DELETE set null;
CREATE INDEX outbound_jobs_user_created_idx ON outbound_jobs(user_id, created_at);
CREATE INDEX outbound_jobs_domain_created_idx ON outbound_jobs(domain_id, created_at);
CREATE TABLE sender_policies (
  id text PRIMARY KEY NOT NULL,
  user_id text REFERENCES users(id) ON DELETE cascade,
  pattern_type text NOT NULL,
  pattern text NOT NULL,
  action text NOT NULL,
  created_by_user_id text REFERENCES users(id) ON DELETE set null,
  created_at integer NOT NULL
);
CREATE UNIQUE INDEX sender_policies_scope_pattern_idx ON sender_policies(user_id, pattern_type, pattern);
CREATE INDEX sender_policies_lookup_idx ON sender_policies(user_id, pattern_type, pattern);
