import { MizanEngine, type EngineOptions } from "../../src/engine/engine.js";
import { MemoryStore, type Store } from "../../src/sync/store.js";
import { FakeBosta } from "./bosta.js";
import { FakeClock, seeded, testRuntime } from "./clock.js";
import { FakeShopify } from "./shopify.js";

export const LOCATION = "gid://shopify/Location/1";

export function setup(overrides: Partial<EngineOptions> = {}, store: Store = new MemoryStore()) {
  const clock = new FakeClock();
  const shop = new FakeShopify(clock, seeded(2));
  const bosta = new FakeBosta(clock, seeded(3));
  const rt = testRuntime(clock, { [shop.host]: shop.handler, [bosta.host]: bosta.handler }, seeded(4));
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
