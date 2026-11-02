-- E10-1: tickets (M6). Each store numbers its tickets T-1001, T-1002…; the reason is a fixed
-- code so returns can be reported by product; every change is a line in ticket_events, which is
-- the ticket's history. The description is written by the team and may hold what a customer
-- said: it is shown on the ticket only, never copied into events or the audit log.
ALTER TABLE tickets DROP CONSTRAINT tickets_type_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_type_check
  CHECK (type IN ('complaint','exchange','refund','delivery_issue','return','refused'));
ALTER TABLE tickets
  ADD COLUMN number       INT,
  ADD COLUMN description  TEXT CHECK (length(description) <= 2000),
  ADD COLUMN source       TEXT NOT NULL DEFAULT 'team' CHECK (source IN ('team','whatsapp','phone','courier','automation')),
  ADD COLUMN created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN due_at       TIMESTAMPTZ,
  ADD COLUMN closed_at    TIMESTAMPTZ,
  ADD COLUMN updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD CONSTRAINT tickets_reason_check CHECK (reason IS NULL OR reason IN (
    'wrong_size','wrong_item','damaged','missing_item','not_as_described','quality','changed_mind',
    'late_delivery','courier_behaviour','not_delivered','price','other'));
UPDATE tickets t SET number = 1000 + n.rn
  FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn FROM tickets) n WHERE n.id = t.id;
ALTER TABLE tickets ALTER COLUMN number SET NOT NULL;
CREATE UNIQUE INDEX tickets_number ON tickets (tenant_id, number);
CREATE INDEX tickets_queue ON tickets (tenant_id, status, created_at DESC);
CREATE INDEX tickets_order ON tickets (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX tickets_assignee ON tickets (tenant_id, assigned_to) WHERE assigned_to IS NOT NULL;

CREATE TABLE ticket_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('created','status','assigned','updated','note')),
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  data        JSONB NOT NULL DEFAULT '{}',
  note        TEXT CHECK (length(note) <= 2000),
  seq         BIGINT GENERATED ALWAYS AS IDENTITY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ticket_events_ticket ON ticket_events (ticket_id, seq);

ALTER TABLE ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ticket_events
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
