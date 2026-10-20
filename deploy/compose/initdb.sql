-- Local prod-like stack only. In GCP these roles come from Terraform (E1-11).
-- The migrator is the postgres owner; the API and worker log in as mizan_api,
-- which only gets the RLS-bound roles (migrations 0003 and 0006 reuse them).
CREATE ROLE mizan_app NOLOGIN NOBYPASSRLS;
CREATE ROLE mizan_worker NOLOGIN NOBYPASSRLS;
CREATE ROLE mizan_api LOGIN PASSWORD 'mizan_api' NOBYPASSRLS IN ROLE mizan_app, mizan_worker;
