ALTER TABLE users ADD COLUMN archived_at integer;

CREATE INDEX users_archived_role_idx
	ON users (archived_at, role, disabled);

CREATE TRIGGER users_keep_active_administrator
BEFORE UPDATE OF role, disabled, archived_at, activation_status ON users
WHEN old.role = 'admin'
	AND old.disabled = 0
	AND old.archived_at IS NULL
	AND old.activation_status = 'active'
	AND NOT (
		new.role = 'admin'
		AND new.disabled = 0
		AND new.archived_at IS NULL
		AND new.activation_status = 'active'
	)
	AND NOT EXISTS (
		SELECT 1 FROM users
		WHERE id <> old.id
			AND role = 'admin'
			AND disabled = 0
			AND archived_at IS NULL
			AND activation_status = 'active'
	)
BEGIN
	SELECT RAISE(ABORT, 'cannot remove the last active administrator');
END;
