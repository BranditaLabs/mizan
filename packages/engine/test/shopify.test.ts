import { describe, expect, it } from "vitest";
import { LOCATION, settle, setup } from "./fakes/setup.js";

describe("Shopify connector", () => {
  it("rides out cost-based throttling by pacing to Shopify's own budget", async () => {
    const { shop, engine } = setup();
    shop.bucket = { max: 50, available: 50, restore: 10, last: shop.bucket.last }; // a tiny bucket
    const o = shop.addOrder();
    for (let i = 0; i < 30; i++) await engine.shopify.getOrder(o.id); // 30 × 10 points against 50 + 10/s
    expect(shop.count("MizanOrder")).toBe(30);
  });

  it("retries an explicit THROTTLED response after the computed wait", async () => {
    const { shop, engine, clock } = setup();
    const o = shop.addOrder();
    shop.faults.push({ fault: "throttle" });
    const t0 = clock.now();
    const order = await engine.shopify.getOrder(o.id);
    expect(order.number).toBe(o.name);
    expect(clock.now()).toBeGreaterThan(t0);
  });

  it("flags when Shopify serves a different API version than pinned", async () => {
    const { shop, engine } = setup();
    shop.servedVersion = "2027-01";
    await engine.shopify.getOrder(shop.addOrder().id);
    expect(engine.drift.report().some((d) => d.kind === "version_fell_forward")).toBe(true);
  });

  it("switches to the fallback query when a field is removed in a new API version", async () => {
    const { shop, engine } = setup();
    shop.rejectFields.add("defaultPhoneNumber");
    const order = await engine.shopify.getOrder(shop.addOrder().id);
    expect(order.customer.email).toBe("mona@example.com"); // read via the older customer.email field
    expect(engine.drift.report().some((d) => d.entity === "MizanOrder" && /switching to variant 1/.test(d.detail))).toBe(true);
    // The switch is remembered: the next call goes straight to the working variant.
    shop.calls = [];
    await engine.shopify.getOrder([...shop.orders.keys()][0]);
    expect(shop.calls.length).toBe(1);
  });

  it("keeps mapping when a field disappears from the payload", async () => {
    const { shop, engine } = setup();
    shop.dropPaths.add("shippingAddress.phone");
    const order = await engine.shopify.getOrder(shop.addOrder().id);
    expect(order.customer.phone).toBe("+201001234821"); // from customer.defaultPhoneNumber
    expect(engine.drift.report().some((d) => d.kind === "fallback_field" && d.field === "customer.phone")).toBe(true);
  });

  it("reads which product each line is, and leaves a deleted product's line unlinked", async () => {
    const { shop, engine } = setup();
    const { variantId } = shop.addProduct({ title: "Vitamin C serum", price: "575.00", sku: "SER-30" });
    const linked = await engine.shopify.getOrder(shop.addOrder().id);
    expect(linked.lines[0]).toMatchObject({ sku: "SER-30", variantExternalId: variantId });
    shop.products.clear();
    const orphan = await engine.shopify.getOrder(shop.addOrder().id);
    expect(orphan.lines[0]!.variantExternalId).toBeUndefined();
    expect(engine.drift.report().some((d) => d.field === "order.lineItem.variantExternalId")).toBe(false); // optional: not drift
  });

  it("reads each variant's barcode; a blank one is no barcode", async () => {
    const { shop, engine } = setup();
    const a = shop.addProduct({ title: "Vitamin C serum", price: "575.00", sku: "SER-30", barcode: " 6221234567890 " });
    const b = shop.addProduct({ title: "Toner", price: "300.00", sku: "TON-1", barcode: "" });
    expect((await engine.shopify.getProduct(a.productId)).variants[0]!.barcode).toBe("6221234567890");
    expect((await engine.shopify.getProduct(b.productId)).variants[0]!.barcode).toBeUndefined();
    expect(engine.drift.report().some((d) => d.field === "product.variant.barcode")).toBe(false); // optional: not drift
  });

  it("rejects webhooks with a bad signature and processes duplicates once", async () => {
    const { shop, engine, store, clock } = setup();
    const o = shop.addOrder();
    const wh = shop.webhook("orders/create", o);
    expect((await engine.handleShopifyWebhook({ ...wh.headers, "X-Shopify-Hmac-SHA256": "Zm9yZ2Vk" }, wh.body)).status).toBe(401);
    expect((await engine.handleShopifyWebhook(wh.headers, wh.body)).body).toEqual({ accepted: true });
    expect((await engine.handleShopifyWebhook(wh.headers, wh.body)).body).toEqual({ duplicate: true });
    await settle(engine, store, clock);
    expect(shop.count("MizanOrder")).toBe(1);
  });

  it("pushes a Mizan price change and stock level to Shopify", async () => {
    const { shop, engine, store, clock } = setup();
    const p = shop.addProduct({ title: "Serum", price: "500.00", stock: 10 });
    await engine.updateProduct({
      productExternalId: p.productId,
      variants: [{ externalId: p.variantId, price: { amount: "575.00", currency: "EGP" } }],
      inventory: [{ inventoryItemId: p.inventoryItemId, locationId: LOCATION, available: 42 }],
    });
    await settle(engine, store, clock);
    expect(shop.products.get(p.productId)!.variants[0].price).toBe("575.00");
    expect(shop.inventory.get(`${p.inventoryItemId}|${LOCATION}`)).toBe(42);
    const inv = shop.calls.find((c) => c.op === "MizanInventorySet")!;
    expect(inv.variables.idempotencyKey).toBeTruthy(); // required by Shopify since 2026-04
  });

  it("re-reads and retries when stock changed between read and write", async () => {
    const { shop, engine, store, clock } = setup();
    const p = shop.addProduct({ title: "Serum", price: "500.00", stock: 10 });
    shop.concurrentStockChanges = 2; // two sales land in the gap
    await engine.updateProduct({ productExternalId: p.productId, inventory: [{ inventoryItemId: p.inventoryItemId, locationId: LOCATION, available: 30 }] });
    await settle(engine, store, clock);
    expect(shop.inventory.get(`${p.inventoryItemId}|${LOCATION}`)).toBe(30);
    expect((await store.jobs({ status: "dead" })).length).toBe(0);
  });

  it("restores Mizan-owned prices edited in Shopify admin, without looping on its own writes", async () => {
    const { shop, engine, store, clock, events } = setup();
    const p = shop.addProduct({ title: "Serum", price: "500.00" });
    await engine.updateProduct({ productExternalId: p.productId, variants: [{ externalId: p.variantId, price: { amount: "575.00", currency: "EGP" } }] });
    await settle(engine, store, clock);

    // Our own write echoes back as products/update: nothing to do.
    let wh = shop.webhook("products/update", shop.products.get(p.productId)!);
    await engine.handleShopifyWebhook(wh.headers, wh.body);
    await settle(engine, store, clock);
    expect(shop.count("MizanVariantsUpdate")).toBe(1);

    // A merchant changes the price in Shopify admin later on.
    clock.advance(10 * 60_000);
    shop.adminSetPrice(p.productId, p.variantId, "450.00");
    wh = shop.webhook("products/update", shop.products.get(p.productId)!);
    await engine.handleShopifyWebhook(wh.headers, wh.body);
    await settle(engine, store, clock);
    expect(shop.products.get(p.productId)!.variants[0].price).toBe("575.00");
    expect(events.some((e) => e.event === "product.conflict" && e.data.action === "restore_mizan_value")).toBe(true);

    // And the restore's own echo does not trigger another write.
    wh = shop.webhook("products/update", shop.products.get(p.productId)!);
    await engine.handleShopifyWebhook(wh.headers, wh.body);
    await settle(engine, store, clock);
    expect(shop.count("MizanVariantsUpdate")).toBe(2);
  });

  it("accepts Shopify's value when Shopify owns the field", async () => {
    const { shop, engine, store, clock } = setup({ ownership: { price: "shopify", compareAtPrice: "shopify", inventory: "mizan" } });
    const p = shop.addProduct({ title: "Serum", price: "500.00" });
    await engine.updateProduct({ productExternalId: p.productId, variants: [{ externalId: p.variantId, price: { amount: "575.00", currency: "EGP" } }] });
    await settle(engine, store, clock);
    clock.advance(10 * 60_000);
    shop.adminSetPrice(p.productId, p.variantId, "450.00");
    const wh = shop.webhook("products/update", shop.products.get(p.productId)!);
    await engine.handleShopifyWebhook(wh.headers, wh.body);
    await settle(engine, store, clock);
    expect(shop.products.get(p.productId)!.variants[0].price).toBe("450.00");
    const state = await store.get<{ desired: { variants: Record<string, { price: string }> } }>("product-state", p.productId);
    expect(state!.desired.variants[p.variantId].price).toBe("450.00");
  });
});
