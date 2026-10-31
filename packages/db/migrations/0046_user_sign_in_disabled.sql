-- A-5: Mizan staff can stop a person signing in to Mizan (abuse, a compromised account, a
-- departed employee the store forgot to remove). The API refuses every request from a disabled
-- user; Firebase keeps the account, so enabling it again is instant.
ALTER TABLE users ADD COLUMN disabled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN disabled_reason TEXT CHECK (char_length(disabled_reason) BETWEEN 3 AND 500);
ALTER TABLE users ADD CONSTRAINT users_disabled_whole CHECK ((disabled_at IS NULL) = (disabled_reason IS NULL));
CREATE INDEX users_email_lower ON users (lower(email));

GRANT UPDATE (disabled_at, disabled_reason) ON users TO mizan_platform;
