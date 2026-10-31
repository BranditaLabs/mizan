import { resolveOrderSource } from "@mizan/shared";
import { describe, expect, it } from "vitest";
import { DriftMonitor } from "../src/adapt/drift.js";
import { mapOrder } from "../src/connectors/shopify/mapper.js";
import { mapWooOrder } from "../src/connectors/woocommerce/mapper.js";
import { FakeClock } from "./fakes/clock.js";
import { setup } from "./fakes/setup.js";
import { FakeWooCommerce } from "./fakes/woocommerce.js";

/** M7-2: each connector copies where the order came from into canonical hints; nothing else is guessed. */
const journey = {
  ready: true,
  firstVisit: { landingPage: "https://nile.shop/?utm_source=tiktok&utm_medium=cpc&utm_campaign=launch", referrerUrl: null, source: "tiktok", sourceType: null, occurredAt: "2026-10-20T09:00:00Z", utmParameters: { source: "tiktok", medium: "cpc", campaign: "launch" } },
  lastVisit: { landingPage: "https://nile.shop/products/abaya?fbclid=IwAR9&email=mona@example.com", referrerUrl: "https://l.instagram.com/", source: "Instagram", sourceType: "SOCIAL", occurredAt: "2026-10-22T19:30:00Z", utmParameters: null },
};

describe("Shopify order source (M7-2)", () => {
  it("reads the customer journey, codes, note attributes and the channel", async () => {
    const { shop, engine } = setup();
    const o = shop.addOrder({ source: { journey, discountCodes: ["EID20"], customAttributes: [{ key: "utm_campaign", value: "eid" }, { key: "gift_note", value: "for Mona" }], sourceName: "web" } });
    const order = await engine.shopify.getOrder(o.id);
    expect(order.source).toMatchObject({
      channel: "web", discountCodes: ["EID20"], attributes: { utm_campaign: "eid" },
      lastVisit: { landingUrl: expect.stringContaining("fbclid=IwAR9"), referrerUrl: "https://l.instagram.com/", source: "Instagram" },
      firstVisit: { utm: { source: "tiktok", medium: "cpc", campaign: "launch" }, occurredAt: "2026-10-20T09:00:00Z" },
    });
    expect(JSON.stringify(order.source)).not.toContain("gift_note");
    expect(resolveOrderSource(order.source)).toMatchObject({ platform: "meta", paid: true, rule: "click_id", firstPlatform: "tiktok", discountCodes: ["EID20"] });
    expect(JSON.stringify(resolveOrderSource(order.source))).not.toContain("mona@");
  });

  it("an order without a journey yet is simply unknown, not drift", async () => {
    const { shop, engine } = setup();
    const order = await engine.shopify.getOrder(shop.addOrder().id);
    expect(order.source).toEqual({ channel: "web" });
    expect(resolveOrderSource(order.source).platform).toBe("unknown");
    expect(engine.drift.report().filter((d) => d.kind === "missing_field")).toEqual([]);
  });

  it("a shop that denies the journey still syncs its orders, without the source fields", async () => {
    const { shop, engine } = setup();
    shop.denyFields.add("customerJourneySummary");
    const o = shop.addOrder({ source: { journey } });
    const order = await engine.shopify.getOrder(o.id);
    expect(order.number).toBe(o.name);
    expect(order.source).toBeUndefined();
    expect(engine.drift.report().some((d) => d.entity === "MizanOrder" && /optional fields refused/.test(d.detail))).toBe(true);
    shop.calls = [];
    await engine.shopify.getOrder(o.id);
    expect(shop.calls.length).toBe(1); // the switch is remembered
  });

  it("an API version without the journey falls back the same way, page by page too", async () => {
    const { shop, engine } = setup();
    shop.rejectFields.add("customerJourneySummary");
    const o = shop.addOrder({ source: { journey } });
    expect((await engine.shopify.getOrder(o.id)).number).toBe(o.name);
    const seen: string[] = [];
    for await (const page of engine.shopify.ordersUpdatedSince(new Date(0).toISOString())) seen.push(...page.map((x) => x.externalId));
    expect(seen).toContain(o.id);
  });

  it("maps a REST-shaped payload (landing and referring sites, note attributes, codes)", () => {
    const order = mapOrder({
      id: "gid://shopify/Order/4501", name: "#1001", createdAt: "2026-10-22T19:31:00Z", updatedAt: "2026-10-22T19:31:00Z", currencyCode: "EGP",
      totalPriceSet: { shopMoney: { amount: "1150.00", currencyCode: "EGP" } }, displayFinancialStatus: "PENDING", paymentGatewayNames: [], lineItems: [], tags: [],
      landing_site: "/products/abaya?utm_source=snapchat&utm_medium=paid", referring_site: "https://www.snapchat.com/",
      note_attributes: [{ name: "ScCid", value: "sc-123" }], discount_codes: [{ code: "SNAP15" }], source_name: "web",
    }, { drift: new DriftMonitor(), now: () => 0, codPatterns: [], paymentPatterns: [] } as never);
    expect(order.source).toMatchObject({ lastVisit: { landingUrl: expect.stringContaining("utm_source=snapchat") }, attributes: { sccid: "sc-123" }, discountCodes: ["SNAP15"] });
    expect(resolveOrderSource(order.source)).toMatchObject({ platform: "snapchat", rule: "click_id", paid: true, utm: { source: "snapchat" } });
  });
});

describe("WooCommerce order source (M7-2)", () => {
  const clock = new FakeClock();
  const ctx = () => ({ drift: new DriftMonitor(), now: () => clock.now() });

  it("reads WooCommerce's order attribution meta and coupons", () => {
    const w = new FakeWooCommerce(clock).addOrder();
    w.meta_data = [
      { id: 1, key: "_wc_order_attribution_source_type", value: "utm" },
      { id: 2, key: "_wc_order_attribution_utm_source", value: "facebook" },
      { id: 3, key: "_wc_order_attribution_utm_medium", value: "cpc" },
      { id: 4, key: "_wc_order_attribution_utm_campaign", value: "white-friday" },
      { id: 5, key: "_wc_order_attribution_session_entry", value: "https://shop.eg/product/abaya?utm_source=facebook&phone=0100" },
      { id: 6, key: "_wc_order_attribution_referrer", value: "https://m.facebook.com/" },
      { id: 7, key: "_billing_phone_verified", value: "yes" },
    ];
    (w as unknown as { coupon_lines: unknown[] }).coupon_lines = [{ id: 9, code: "wf25" }];
    const order = mapWooOrder(w, ctx());
    expect(order.source).toMatchObject({ lastVisit: { sourceType: "utm", utm: { source: "facebook", medium: "cpc", campaign: "white-friday" } }, discountCodes: ["wf25"] });
    const s = resolveOrderSource(order.source);
    expect(s).toMatchObject({ platform: "meta", paid: true, rule: "utm", utm: { campaign: "white-friday" }, landingPath: "/product/abaya" });
    expect(JSON.stringify(s)).not.toContain("0100");
  });

  it("'(direct)' is no source; dashboard orders are manual", () => {
    const typed = new FakeWooCommerce(clock).addOrder();
    typed.meta_data = [{ id: 1, key: "_wc_order_attribution_source_type", value: "typein" }, { id: 2, key: "_wc_order_attribution_utm_source", value: "(direct)" }];
    expect(resolveOrderSource(mapWooOrder(typed, ctx()).source)).toMatchObject({ platform: "direct", paid: false });
    const admin = new FakeWooCommerce(clock).addOrder();
    admin.meta_data = [{ id: 1, key: "_wc_order_attribution_source_type", value: "admin" }];
    expect(resolveOrderSource(mapWooOrder(admin, ctx()).source).platform).toBe("manual");
    expect(mapWooOrder(new FakeWooCommerce(clock).addOrder(), ctx()).source).toBeUndefined();
  });
});
