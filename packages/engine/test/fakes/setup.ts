import { MizanEngine, type EngineOptions } from "../../src/engine/engine.js";
import { MemoryStore, type Store } from "../../src/sync/store.js";
import { FakeBosta } from "./bosta.js";
import { FakeClock, seeded, testRuntime } from "./clock.js";
import { FakeShopify } from "./shopify.js";
import { FakeWooCommerce } from "./woocommerce.js";

export const LOCATION = "gid://shopify/Location/1";

/** `seed` varies every random fault pattern; CHAOS_SEED overrides it for seed sweeps. */
export function setup(overrides: Partial<EngineOptions> = {}, store: Store = new MemoryStore(), seed = Number(process.env.CHAOS_SEED ?? 0)) {
  const clock = new FakeClock();
  const shop = new FakeShopify(clock, seeded(2 + seed * 7));
  const bosta = new FakeBosta(clock, seeded(3 + seed * 7));
  const rt = testRuntime(clock, { [shop.host]: shop.handler, [bosta.host]: bosta.handler }, seeded(4 + seed * 7));
  const engine = new MizanEngine(store, rt, {
    shopify: { shop: shop.host, accessToken: "shpat_test", apiVersion: "2026-10", clientSecret: shop.secret },
    bosta: {
      apiKey: bosta.apiKey, baseUrl: bosta.baseUrl, webhookSecret: "whsec-bosta",
      webhookUrl: "https://mizan.test/webhooks/bosta", trackingUrlTemplate: "https://bosta.co/tracking-shipments?shipment-number={tn}",
    },
    locationId: LOCATION,
    ...overrides,
  });
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  engine.on((event, data) => events.push({ event, data }));
  return { clock, shop, bosta, rt, store, engine, events };
}

/** An engine with a WooCommerce store (E5-7) next to the usual fakes. */
export function setupWoo(overrides: Partial<EngineOptions> = {}, store: Store = new MemoryStore(), seed = Number(process.env.CHAOS_SEED ?? 0)) {
  const clock = new FakeClock();
  const shop = new FakeShopify(clock, seeded(2 + seed * 7));
  const bosta = new FakeBosta(clock, seeded(3 + seed * 7));
  const woo = new FakeWooCommerce(clock, seeded(5 + seed * 7));
  const rt = testRuntime(clock, { [shop.host]: shop.handler, [bosta.host]: bosta.handler, [woo.host]: woo.handler }, seeded(6 + seed * 7));
  const orders: Array<{ id: string; number: string; paymentMode: string; paymentStatus: string; outstanding: string | undefined; cancelled: boolean; phone: string | undefined }> = [];
  const learned: unknown[] = [];
  const engine = new MizanEngine(store, rt, {
    shopify: { shop: shop.host, accessToken: "shpat_test", apiVersion: "2026-10", clientSecret: shop.secret },
    bosta: { apiKey: bosta.apiKey, baseUrl: bosta.baseUrl, webhookSecret: "whsec-bosta", webhookUrl: "https://mizan.test/webhooks/bosta" },
    woocommerce: { siteUrl: woo.siteUrl, consumerKey: woo.consumerKey, consumerSecret: woo.consumerSecret, webhookSecret: woo.webhookSecret, webhookUrl: "https://mizan.test/webhooks/woocommerce/c1" },
    ...overrides,
    hooks: {
      onOrder: async (o) => { orders.push({ id: o.externalId, number: o.number, paymentMode: o.paymentMode, paymentStatus: o.paymentStatus, outstanding: o.outstanding?.amount, cancelled: o.cancelled, phone: o.customer.phone }); },
      onLearned: async (provider, state) => { learned.push({ provider, state }); },
      ...overrides.hooks,
    },
  });
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  engine.on((event, data) => events.push({ event, data }));
  /** The last version of each order the platform was given. */
  const latest = () => new Map(orders.map((o) => [o.id, o]));
  return { clock, woo, rt, store, engine, events, orders, latest, learned };
}

/** Run jobs; when only future retries remain, jump the clock to the next one. Stops when the queue is empty. */
export async function settle(engine: MizanEngine, store: Store, clock: FakeClock, maxRounds = 200) {
  for (let i = 0; i < maxRounds; i++) {
    await engine.drain();
    const pending = (await store.jobs({ status: "pending" })).concat(await store.jobs({ status: "running" }));
    if (!pending.length) return;
    const next = Math.min(...pending.map((j) => Math.max(j.nextAttemptAt, j.lockedUntil ?? 0)));
    if (next > clock.now()) clock.t = next;
  }
  throw new Error("queue did not settle");
}
