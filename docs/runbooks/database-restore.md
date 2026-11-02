# Runbook — restore the database (E13-1)

Azure Database for PostgreSQL Flexible Server keeps **14 days of backups** with point-in-time recovery over the whole window (`backup_retention_days` in `infra/main.tf`). A restore never overwrites the live server: it makes a **new server**, you check it, then switch the app to it.

## When

- Data was deleted or corrupted by a bad deploy, a bad migration or a mistake (restore to just before it).
- The server is lost (restore the latest restorable point into a new server).

## Steps (Azure Cloud Shell, as an Owner of the environment's subscription)

```bash
ENV=<staging|production>; RG=rg-mizan-$ENV
SOURCE=$(az postgres flexible-server list -g $RG --query '[0].name' -o tsv)
TARGET=${SOURCE%-pg}-restored-pg

# 1. Freeze writes: deactivate the API's and worker's active revisions (the dashboard shows "unavailable").
for app in ca-mizan-api ca-mizan-worker; do
  az containerapp revision deactivate -g $RG -n $app --revision "$(az containerapp show -g $RG -n $app --query properties.latestRevisionName -o tsv)"
done

# 2. Restore to a moment (UTC, ISO 8601), e.g. one minute before the bad change. Omit
#    --restore-time for the latest restorable point. Same region, same admin login/password.
az postgres flexible-server restore -g $RG --name $TARGET --source-server $SOURCE --restore-time "2026-10-30T09:14:00Z"
#    Production: re-enable zone-redundant HA on the new server (az postgres flexible-server update --high-availability ZoneRedundant).
#    Firewall: check the new server has the rules the old one had (az postgres flexible-server firewall-rule list).

# 3. Check the new server (psql with sslmode=require as mizan_migrator): row counts of
#    orders, payments, stock_movements; the last order's time; the schema_migrations version.
```

4. **Switch:** add new versions of the Key Vault secrets `database-url` and `database-url-migrator` pointing at `$TARGET.postgres.database.azure.com` (same users and passwords; `az keyvault secret set --vault-name <vault> --name database-url --value '…'`, never echo the value). Container Apps reference the versionless secrets, so restart a revision to pick them up. Run the migrate job once (`az containerapp job start -g $RG -n caj-mizan-migrate`).
5. **Unfreeze:** activate the revisions again (`az containerapp revision activate`, the same names), watch the dashboard and the alerts for 30 minutes.
6. **Afterwards:** bring Terraform in line in a quiet window (import the new server into state in place of the old, or restore back into the managed name); until then do not run `terraform apply`, which would rewrite the generated database secrets to the old server. Keep the old server 7 days, then delete it. Write what happened in an incident note.

Customer data never leaves the subscription during a restore. Do not export dumps to laptops.

## Drill (every quarter, on staging)

1. Note the time, create an order on staging, wait 5 minutes, delete it by hand in the database.
2. Restore to the noted time (step 2), check the order is there, time how long it took.
3. Delete the restored server. Record the date and duration below; the target is **under 60 minutes** end to end.

| Date | Environment | Kind | Duration | By |
| --- | --- | --- | --- | --- |
| | staging | point in time | | |
