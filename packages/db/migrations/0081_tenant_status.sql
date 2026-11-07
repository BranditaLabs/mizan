-- E12-2a3: tenants.status is the platform lifecycle only (active, suspended, deleted). Whether a
-- store is trying a plan is its subscription's business (subscriptions.status = 'trialing').
-- 'trial' was never set; any such row becomes active.
UPDATE tenants SET status = 'active' WHERE status = 'trial';
ALTER TABLE tenants DROP CONSTRAINT tenants_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check CHECK (status IN ('active','suspended','deleted'));
