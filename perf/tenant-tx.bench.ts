/**
 * Micro-benchmark: cost of a tenant-scoped read transaction on real PostgreSQL.
 *   TEST_DATABASE_URL=postgres://… npx tsx --conditions=source perf/tenant-tx.bench.ts
 */
import { createPgDb, migrate, pgMigrationClient, withTenant } from "@mizan/db";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
const name = `mizan_bench_${process.pid}`;
const admin = new pg.Client({ connectionString: url });
await admin.connect();
await admin.query(`CREATE DATABASE ${name}`);
const dbUrl = Object.assign(new URL(url), { pathname: `/${name}` }).toString();
try {
  const mc = await pgMigrationClient(dbUrl);
  await migrate(mc);
  await mc.close();
  const db = createPgDb(dbUrl, { max: 10 });
  const T = "aaaaaaaa-0000-4000-8000-000000000001";
  await db.insertInto("tenants").values({ id: T, name: "Bench", slug: "bench" }).execute();
  const N = Number(process.env.N ?? 3000);
  const run = () => withTenant(db, T, (trx) => trx.selectFrom("orders").select("id").limit(1).execute());
  for (let i = 0; i < 200; i++) await run(); // warm up
  const t0 = performance.now();
  for (let i = 0; i < N; i++) await run();
  const sequential = (performance.now() - t0) / N;
  const t1 = performance.now();
  await Promise.all(Array.from({ length: N }, run));
  const parallel = N / ((performance.now() - t1) / 1000);
  console.log(JSON.stringify({ sequentialMsPerTx: +sequential.toFixed(3), parallelTxPerSec: Math.round(parallel) }));
  await db.destroy();
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
}
