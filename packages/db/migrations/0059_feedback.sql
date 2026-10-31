-- L1-8: in-app feedback. A store member sends an idea, a problem or a question from any screen;
-- Mizan staff read it in the back office and mark it seen or done. It is a platform table (like
-- sso_domains): it names the store (store_id) but is not the store's data, so the store never reads
-- it back. The app role may only add a line, for the store it is working in; the back office reads
-- every line and changes only its status. The page is a path, never a query string (no ids or
-- tokens from a URL), and the message is what the person chose to write.
CREATE TABLE feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('idea','problem','question')),
  message     TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  page        TEXT NOT NULL DEFAULT '' CHECK (char_length(page) <= 300 AND page !~ '[?#]'),
  locale      TEXT NOT NULL CHECK (locale IN ('ar','en')),
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','seen','done')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX feedback_recent ON feedback (created_at DESC);
CREATE INDEX feedback_open ON feedback (status, created_at DESC) WHERE status <> 'done';

-- Row-level security: an app insert must name the store of its tenant context; the back office sees all.
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY store_append ON feedback FOR INSERT TO mizan_app
  WITH CHECK (store_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND status = 'new');
CREATE POLICY platform_all ON feedback TO mizan_platform USING (true) WITH CHECK (true);

-- The app adds lines only (it generates the id, so it never needs RETURNING); nothing else reads it.
REVOKE ALL ON feedback FROM mizan_app, mizan_worker;
GRANT INSERT (id, store_id, user_id, kind, message, page, locale) ON feedback TO mizan_app;
GRANT SELECT ON feedback TO mizan_platform;
GRANT UPDATE (status, updated_at) ON feedback TO mizan_platform;
