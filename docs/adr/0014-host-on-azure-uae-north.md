# ADR-0014: Host on Azure UAE North

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

The owner selected Microsoft Azure for Mizan hosting. The deployment must keep merchant data in
the UAE launch region, preserve Firebase Authentication, and provide least-privilege managed
identities for the API, dashboard and migration job.

## Decision

Host in Azure UAE North (`uaenorth`). Run the API, worker and dashboard on Azure Container Apps,
with a Container Apps Job for migrations. Use Azure Database for PostgreSQL Flexible Server 16,
Azure Key Vault with RBAC, and an RSA 3072 Key Vault key named `tenant-secrets`, used through
user-assigned managed identities, for merchant-credential envelope encryption. Firebase Authentication remains unchanged and is used
for identity only. DNS remains at Hostinger; Container Apps custom domains use free managed
certificates after CNAME and `asuid` TXT verification records are published.

## Consequences

Production data is hosted in UAE North. Firebase Authentication is a global service and holds
identity data only. Counsel must confirm, as before, that Egyptian data may be hosted outside
Egypt and whether any licence or registration is required. Add a KSA deployment in an Azure
Saudi region when one is available and appropriate for in-Kingdom data residency.

Without a VNet, Consumption Container Apps have no stable egress IPs, so PostgreSQL allows Azure
services through the `0.0.0.0` firewall rule (`db_allow_azure_services`) and Key Vault keeps its
public endpoint behind Entra RBAC. Before production launch the database (and Key Vault) must move
to VNet integration or private endpoints and that rule must be turned off; Terraform warns while
it is on in production.
