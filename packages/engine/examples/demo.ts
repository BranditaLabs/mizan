/**
 * A narrated run of the engine against misbehaving fake Shopify and Bosta
 * servers. No credentials or network needed:  npm run demo
 */
import { LOCATION, settle, setup } from "../test/fakes/setup.js";

const line = (s = "") => console.log(s);
const step = (n: number, s: string) => line(`\n\x1b[1m${n}. ${s}\x1b[0m`);
const ok = (s: string) => line(`   \x1b[32m✓\x1b[0m ${s}`);
const note = (s: string) => line(`   \x1b[2m${s}\x1b[0m`);

const ctx = setup();
const { shop, bosta, engine, store, clock, events } = ctx;
let failed = 0;
(ctx.rt as { logger: unknown }).logger = { log: (_l: string, m: string) => { if (m === "request failed") failed++; } };

line("\x1b[1mMizan integration engine · demo\x1b[0m");
note("Fake Shopify and Bosta servers; 30% of all calls fail (5xx, hangs, throttling, dropped connections).");
shop.randomFaultRate = 0.3;
bosta.randomFaultRate = 0.3;

step(1, "Orders arrive from Shopify (one webhook lost, one duplicated)");
const orders = [
  shop.addOrder({ tags: ["mizan-confirmed"], city: "Nasr City", province: "Cairo" }),
  shop.addOrder({ tags: ["mizan-confirmed"], city: "6th of October", province: "Giza", cod: false }),
  shop.addOrder({ tags: ["mizan-confirmed"], city: "المنصورة", province: "الدقهلية" }),
];
const w0 = shop.webhook("orders/create", orders[0]);
await engine.handleShopifyWebhook(w0.headers, w0.body);
await engine.handleShopifyWebhook(w0.headers, w0.body); // duplicate
const w1 = shop.webhook("orders/create", orders[1]);
await engine.handleShopifyWebhook(w1.headers, w1.body);
// orders[2]'s webhook never arrives
await settle(engine, store, clock);
clock.advance(5 * 60_000);
await engine.scheduleReconcile(); // polling picks up the lost one
await settle(engine, store, clock);
for (const o of orders) {
  const rec = await store.get<{ trackingNumber?: string }>("order", o.id);
  const d = bosta.deliveries.get(rec!.trackingNumber!)!;
  ok(`${o.name} → Bosta ${d.trackingNumber} · city "${o.shippingAddress?.city}" → ${d.dropOffAddress.city} · COD EGP ${d.cod}`);
}
ok(`${bosta.deliveries.size} deliveries for ${orders.length} orders (no duplicates)`);
ok(`Shopify fulfilled with tracking: ${orders.map((o) => shop.orders.get(o.id)!.fulfillments.length).join(", ")}`);

step(2, "Bosta loses a response after creating a delivery");
bosta.randomFaultRate = 0;
bosta.loseNextCreateResponses = 1;
const o4 = shop.addOrder({ tags: ["mizan-confirmed"] });
const w4 = shop.webhook("orders/create", o4);
await engine.handleShopifyWebhook(w4.headers, w4.body);
await settle(engine, store, clock);
const refs = [...bosta.deliveries.values()].filter((d) => d.businessReference === o4.id).length;
ok(`timed out, searched Bosta by reference, adopted the existing delivery → ${refs} delivery`);
bosta.randomFaultRate = 0.3;

step(3, "Bosta changes its payload shape and sends statuses out of order");
bosta.shape = "flat";
for (const d of bosta.deliveries.values()) {
  clock.advance(60_000);
  bosta.setState(d.trackingNumber, 21, "Picked up");
  const early = bosta.webhook(d.trackingNumber);
  clock.advance(60_000);
  bosta.setState(d.trackingNumber, 45, "Delivered");
  await engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, bosta.webhook(d.trackingNumber));
  await engine.handleBostaWebhook({ token: "whsec-bosta" }, {}, early); // late "picked up"
}
await settle(engine, store, clock);
for (const o of [...orders, o4]) {
  const rec = await store.get<{ trackingNumber: string }>("order", o.id);
  const s = await store.get<{ shipment: { status: string } }>("shipment", rec!.trackingNumber);
  ok(`${o.name}: ${s!.shipment.status} · Shopify payment ${shop.orders.get(o.id)!.displayFinancialStatus}`);
}

step(4, "Mizan changes a price and stock; a merchant overrides the price in Shopify admin");
const p = shop.addProduct({ title: "Vitamin C serum", price: "500.00", stock: 12 });
shop.concurrentStockChanges = 1;
await engine.updateProduct({
  productExternalId: p.productId,
  variants: [{ externalId: p.variantId, price: { amount: "575.00", currency: "EGP" } }],
  inventory: [{ inventoryItemId: p.inventoryItemId, locationId: LOCATION, available: 60 }],
});
await settle(engine, store, clock);
ok(`Shopify price ${shop.products.get(p.productId)!.variants[0].price}, stock ${shop.inventory.get(`${p.inventoryItemId}|${LOCATION}`)} (a sale landed mid-write; re-read and retried)`);
clock.advance(10 * 60_000);
shop.adminSetPrice(p.productId, p.variantId, "450.00");
const wp = shop.webhook("products/update", shop.products.get(p.productId)!);
await engine.handleShopifyWebhook(wp.headers, wp.body);
await settle(engine, store, clock);
ok(`admin edit to 450.00 detected and restored → ${shop.products.get(p.productId)!.variants[0].price} (Mizan owns price)`);

step(5, "Health");
const h = await engine.health();
ok(`requests that failed and were absorbed: ${failed}`);
ok(`outbox: ${h.outbox.pending} pending, ${h.outbox.dead} dead-lettered`);
ok(`circuits: Shopify ${h.shopify.circuit.state}, Bosta ${h.bosta.circuit.state} · Bosta codes learned: ${h.bosta.learnedCodes}`);
line("\n   Drift report (what changed at the providers, for the adapter backlog):");
for (const d of h.drift.slice(0, 6)) note(`   ${String(d.count).padStart(3)}× ${d.connector} ${d.entity} · ${d.kind}${d.field ? ` · ${d.field}` : ""} — ${d.detail}`);
line(`\n   ${events.length} engine events emitted.`);
