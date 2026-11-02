-- A-2: the back office manages stores. Staff may change a store's plan and status (suspend /
-- reactivate) and leave internal notes. Every such change is also written to the store's own
-- audit_log (actor_type 'mizan_staff'), so the merchant sees what Mizan did to their store.
GRANT UPDATE (plan, status, updated_at) ON tenants TO mizan_platform;

-- Append to any store's audit log; never read, change or delete it.
GRANT INSERT ON audit_log TO mizan_platform;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO mizan_platform;
CREATE POLICY staff_append ON audit_log FOR INSERT TO mizan_platform WITH CHECK (actor_type = 'mizan_staff');

-- Internal notes about a store (support context). Not shown to the store; the app role cannot read them.
CREATE TABLE platform_store_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id    UUID REFERENCES platform_staff(id) ON DELETE SET NULL,
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX platform_store_notes_store ON platform_store_notes (store_id, created_at DESC);
REVOKE ALL ON platform_store_notes FROM mizan_app, mizan_worker;
GRANT SELECT, INSERT ON platform_store_notes TO mizan_platform;
