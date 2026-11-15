CREATE TABLE drive_sso_codes (
	code_hash text PRIMARY KEY NOT NULL,
	state_hash text NOT NULL,
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at integer NOT NULL,
	used_at integer,
	created_at integer NOT NULL
);
CREATE INDEX drive_sso_codes_expires_idx ON drive_sso_codes (expires_at);
