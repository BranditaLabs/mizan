import { describe, expect, it } from "vitest";
import { SHOPIFY_WEBHOOK_TOPICS } from "../src/engine/engine.js";
import { settle, setup } from "./fakes/setup.js";

const URI = "https://api.mizan.test/webhooks/shopify/conn-1";

describe("Shopify webhook registration", () => {
  it("creates every subscription once, removes stale ones, and survives repeats and outages", async () => {
    const { engine, shop, store, clock, events } = setup({ shopify: { shop: "fake-store.myshopify.com", accessToken: "shpat_test", apiVersion: "2026-10", clientSecret: "shpss_test_secret", webhookUrl: URI } });
    // Left over from an earlier install on another URL, plus one topic we no longer use.
    shop.webhooks.set("gid://shopify/WebhookSubscription/1", { topic: "ORDERS_CREATE", uri: "https://old.mizan.test/webhooks/shopify/x" });
    shop.webhooks.set("gid://shopify/WebhookSubscription/2", { topic: "CUSTOMERS_UPDATE", uri: URI });
    shop.faults.push({ op: "MizanWebhookCreate", fault: "500" }, { op: "MizanWebhookSubscriptions", fault: "timeout" });

    await engine.registerShopifyWebhooks("install-1");
    await engine.registerShopifyWebhooks("install-1"); // same connect: one job
    await settle(engine, store, clock);

    const subs = [...shop.webhooks.values()];
    expect(subs.map((w) => w.topic).sort()).toEqual([...SHOPIFY_WEBHOOK_TOPICS].sort());
    expect(subs.every((w) => w.uri === URI)).toBe(true);
    expect(events.filter((e) => e.event === "shopify.webhooks_synced")).toHaveLength(1);

    // A reinstall registers again; already-present subscriptions are kept, not duplicated.
    await engine.registerShopifyWebhooks("install-2");
    await settle(engine, store, clock);
    expect(shop.webhooks.size).toBe(SHOPIFY_WEBHOOK_TOPICS.length);
    expect(events.filter((e) => e.event === "shopify.webhooks_synced").at(-1)!.data).toMatchObject({ created: [], deleted: 0 });
  });

  it("an app without customer data approval: the other topics register, the store is told, approval is picked up hourly", async () => {
    const { engine, shop, store, clock, events } = setup({ shopify: { shop: "fake-store.myshopify.com", accessToken: "shpat_test", apiVersion: "2026-10", clientSecret: "shpss_test_secret", webhookUrl: URI } });
    shop.customerDataApproved = false; // seen on staging, Nov 2026: order topics refused, and before this fix app/uninstalled never registered
    await engine.registerShopifyWebhooks("install-1");
    await settle(engine, store, clock);
    expect([...shop.webhooks.values()].map((w) => w.topic).sort()).toEqual(["APP_UNINSTALLED", "PRODUCTS_UPDATE"]);
    const synced = events.filter((e) => e.event === "shopify.webhooks_synced");
    expect(synced.at(-1)!.data).toMatchObject({ refused: ["ORDERS_CREATE", "ORDERS_UPDATED", "ORDERS_CANCELLED"] });
    expect(events.some((e) => e.event === "job.dead")).toBe(false); // not a dead job for a person

    shop.customerDataApproved = true; // the app's protected customer data is approved
    await clock.advance(3_600_000);
    await engine.scheduleReconcile();
    await settle(engine, store, clock);
    expect(shop.webhooks.size).toBe(SHOPIFY_WEBHOOK_TOPICS.length);
  });

  it("reads subscriptions from the older endpoint shape when `uri` is missing", async () => {
    const { engine, shop, store, clock } = setup({ shopify: { shop: "fake-store.myshopify.com", accessToken: "shpat_test", apiVersion: "2026-10", clientSecret: "shpss_test_secret", webhookUrl: URI } });
    shop.webhooks.set("gid://shopify/WebhookSubscription/9", { topic: "ORDERS_CREATE", uri: URI });
    shop.rejectFields.add("uri");
    await engine.registerShopifyWebhooks("install-1");
    await settle(engine, store, clock);
    expect(shop.webhooks.has("gid://shopify/WebhookSubscription/9")).toBe(true); // matched through endpoint.callbackUrl, kept
    expect(shop.webhooks.size).toBe(SHOPIFY_WEBHOOK_TOPICS.length);
  });

  it("refuses to run without a webhook URL (dead letter, not a guess)", async () => {
    const { engine, store, clock } = setup();
    await engine.registerShopifyWebhooks("install-1");
    await settle(engine, store, clock);
    expect((await store.jobs({ status: "dead" })).map((j) => j.kind)).toEqual(["shopify.syncWebhooks"]);
  });
});
