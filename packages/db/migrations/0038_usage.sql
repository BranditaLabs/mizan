-- E12-3: usage per store per month (billing, E12). The live month is counted from the source tables
-- in the store's time zone (orders placed, WhatsApp messages sent, offers Claude wrote); once a
-- month is over its numbers are frozen here, so an invoice never changes after the fact.
CREATE TABLE usage_months (
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month              DATE NOT NULL CHECK (extract(day FROM month) = 1),
  orders             INT NOT NULL CHECK (orders >= 0),
  whatsapp_messages  INT NOT NULL CHECK (whatsapp_messages >= 0),
  ai_offers          INT NOT NULL CHECK (ai_offers >= 0),
  stores             INT NOT NULL CHECK (stores >= 0),
  users              INT NOT NULL CHECK (users >= 0),
  plan               TEXT NOT NULL,
  closed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, month)
);

ALTER TABLE usage_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_months FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON usage_months
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Counting a month's messages sent.
CREATE INDEX whatsapp_messages_out ON whatsapp_messages (tenant_id, created_at) WHERE direction = 'out';
