-- Webhook routing (H-5). Provider webhooks arrive at /webhooks/<provider>/<connection id>
-- without a tenant context. The platform role may read only the routing columns of
-- connections — never credentials, config or learned data — to find the tenant.
GRANT SELECT (id, tenant_id, provider, status) ON connections TO mizan_worker;
CREATE POLICY worker_route ON connections FOR SELECT TO mizan_worker USING (true);
