# Runbook — restore the database (E13-1)

Cloud SQL keeps **14 daily backups** and **7 days of point-in-time recovery** (`infra/main.tf`). A restore never overwrites the live instance: it makes a **clone**, you check it, then switch the app to it.

## When

- Data was deleted or corrupted by a bad deploy, a bad migration or a mistake (restore to just before it).
- The instance is lost (restore the last backup into a new instance).

## Steps (Cloud Shell, as a project owner)

```bash
PROJECT=<project-id>; INSTANCE=mizan-<env>; REGION=me-central1
gcloud config set project $PROJECT

# 1. Freeze writes: scale the API and worker to zero (the dashboard shows "unavailable").
gcloud run services update mizan-api    --region $REGION --min-instances 0 --max-instances 0
gcloud run services update mizan-worker --region $REGION --min-instances 0 --max-instances 0

# 2a. To a moment (UTC, RFC 3339), e.g. one minute before the bad change:
gcloud sql instances clone $INSTANCE ${INSTANCE}-restored --point-in-time "2026-10-30T09:14:00Z"
# 2b. Or from a backup:
gcloud sql backups list --instance $INSTANCE
gcloud sql instances create ${INSTANCE}-restored --region $REGION --database-version POSTGRES_16 --tier <same tier>
gcloud sql backups restore <BACKUP_ID> --restore-instance ${INSTANCE}-restored --backup-instance $INSTANCE

# 3. Check the clone (Cloud SQL Studio, or psql through the Auth Proxy): row counts of
#    orders, payments, stock_movements; the last order's time; the schema_migrations version.
```

4. **Switch:** set `DATABASE_URL` and `DATABASE_URL_MIGRATOR` secrets to the clone's connection name (`gcloud secrets versions add mizan-database-url --data-file=-`), and the Cloud Run services' Cloud SQL instance to the clone (`gcloud run services update mizan-api --region $REGION --set-cloudsql-instances <project>:<region>:${INSTANCE}-restored`, same for `mizan-worker` and the `mizan-migrate` job). Then run the migrate job once.
5. **Unfreeze:** restore min/max instances (`infra/envs/<env>.tfvars`), watch the dashboard and the error-log alert for 30 minutes.
6. **Afterwards:** import the clone into Terraform state or rename it back in a quiet window; keep the old instance 7 days, then delete it. Write what happened in an incident note.

Customer data never leaves the project during a restore. Do not export dumps to laptops.

## Drill (every quarter, on staging)

1. Note the time, create an order on staging, wait 5 minutes, delete it by hand in the database.
2. Clone to the noted time (step 2a), check the order is there, time how long it took.
3. Delete the clone. Record the date and duration below; the target is **under 60 minutes** end to end.

| Date | Environment | Kind | Duration | By |
| --- | --- | --- | --- | --- |
| | staging | point in time | | |
