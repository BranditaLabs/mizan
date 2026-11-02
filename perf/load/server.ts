/**
 * Load-test target: the real API (built `apps/api/dist`) on PostgreSQL, in its own
 * process so the load generator never shares its event loop. Seeds LOAD_TENANTS
 * stores, each with an owner and a Shopify connection (unless LOAD_SEED=0: a further
 * instance on the same database), then prints `READY <port>`.
 *
 * Only the identity provider is replaced: tokens `u<i>` belong to the owner of store i,
 * and `new-<anything>` signs in a fresh user (signup). Everything else is production code.
 */
import { createApp } from "../../apps/api/dist/bootstrap.js";
import { loadConfig } from "../../apps/api/dist/platform/config.js";
import { ProblemError } from "../../apps/api/dist/platform/http/problem.js";
import { bufferedDestination } from "../../apps/api/dist/platform/logging/logger.module.js";
import { Database } from "../../apps/api/dist/platform/db/database.js";
import { SecretsService } from "../../apps/api/dist/platform/secrets/secrets.service.js";

const url = process.env.LOAD_DATABASE_URL!;
const tenants = Number(process.env.LOAD_TENANTS ?? 2000);
const secret = process.env.LOAD_SHOPIFY_SECRET!;

const verifier = {
  async verify(token: string) {
    const m = /^(u\d+|new-[\w-]+)$/.exec(token);
    if (!m) throw new ProblemError(401, "token_invalid", "the sign-in token is not valid");
    return { uid: `fb-${token}`, emailVerified: false, name: "Load" };
  },
};

const config = loadConfig({
  NODE_ENV: "development", LOG_FORMAT: "json", LOG_LEVEL: process.env.LOAD_LOG_LEVEL ?? "info", WORKER_IN_PROCESS: "false",
  PUBLIC_URL: "http://localhost", WEB_URL: "http://localhost:3000",
  DATABASE_URL: url, DATABASE_POOL_MAX: process.env.LOAD_POOL_MAX ?? "20",
  SHOPIFY_API_SECRET: secret, SECRETS_DEV_KEY: Buffer.alloc(32, 7).toString("base64"),
  RATE_LIMIT_IP_PER_MIN: "0", // every request comes from one IP here; per-user limits stay on
});
// Request logs are serialized and written as in production (buffered), to /dev/null.
const app = await createApp(config, { logDestination: bufferedDestination("/dev/null"), tokenVerifier: verifier as never });
await app.init();
const db = app.get(Database);
const secrets = app.get(SecretsService);

const ids = Array.from({ length: process.env.LOAD_SEED === "0" ? 0 : tenants }, (_, i) => i);
for (let start = 0; start < ids.length; start += 500) {
  const chunk = ids.slice(start, start + 500);
  const users = await db.kysely.insertInto("users")
    .values(chunk.map((i) => ({ firebase_uid: `fb-u${i}`, display_name: "Load" }))).returning("id").execute();
  const stores = await db.kysely.insertInto("tenants")
    .values(chunk.map((i) => ({ name: `Load ${i}`, slug: `load-${i}` }))).returning("id").execute();
  await db.kysely.insertInto("memberships")
    .values(chunk.map((_, k) => ({ tenant_id: stores[k]!.id, user_id: users[k]!.id, role: "owner" }))).execute();
  await Promise.all(chunk.map((i, k) => db.tenant(stores[k]!.id, async (trx) => {
    const T = stores[k]!.id;
    const ref = await secrets.create(trx, T, JSON.stringify({ accessToken: `shpat_load_${i}` }), { actor: { type: "system" } });
    await trx.insertInto("connections").values({ tenant_id: T, kind: "store", provider: "shopify", external_account: `s${i}.myshopify.com`, secret_ref: ref }).execute();
  })));
}

const server = await app.listen(0, "127.0.0.1");
process.stdout.write(`READY ${server.address().port}\n`);
process.on("SIGTERM", () => void app.close().then(() => process.exit(0)));
