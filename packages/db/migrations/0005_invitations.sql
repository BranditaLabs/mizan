-- Team invitations (E1-7). An invitation targets an email or a phone; it is
-- accepted by a signed-in user whose verified email, or OTP-verified phone,
-- matches. Memberships are created only on acceptance.

CREATE TABLE invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email           TEXT CHECK (email = lower(email)),
  phone_e164      TEXT CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  role            TEXT NOT NULL CHECK (role IN ('owner','admin','ops_manager','agent','warehouse','finance','media_buyer')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  invited_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  accepted_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at     TIMESTAMPTZ,
  CHECK (num_nonnulls(email, phone_e164) = 1)
);
CREATE UNIQUE INDEX invitations_pending_email ON invitations (tenant_id, email) WHERE status = 'pending' AND email IS NOT NULL;
CREATE UNIQUE INDEX invitations_pending_phone ON invitations (tenant_id, phone_e164) WHERE status = 'pending' AND phone_e164 IS NOT NULL;
CREATE INDEX invitations_email ON invitations (email) WHERE status = 'pending';
CREATE INDEX invitations_phone ON invitations (phone_e164) WHERE status = 'pending';

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- The invitee sees their own pending invitations before joining (GET /me).
-- app.user_email is only set from a *verified* email (see setActingUser).
CREATE POLICY invitee_read ON invitations
  FOR SELECT
  USING (status = 'pending' AND (
    email = NULLIF(current_setting('app.user_email', true), '')
    OR phone_e164 = NULLIF(current_setting('app.user_phone', true), '')
  ));
