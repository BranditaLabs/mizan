import { describe, expect, it } from "vitest";
import { MizanEngine } from "../src/engine/engine.js";
import { classify } from "../src/connectors/paymob/client.js";
import { intentionBody, mapIntention } from "../src/connectors/paymob/mapper.js";
import type { PaymentLinkOutcome, PaymentLinkRequest } from "../src/core/payment-link.js";
import type { HttpResponse } from "../src/resilience/http.js";
import { settle, setupPaymob } from "./fakes/setup.js";

/**
 * E14-2a: Paymob payment links — an intention per attempt, the hosted checkout page, the 60-minute
 * auth token, error classes; a lost create never surfaces and is never re-sent as itself; no
 * secret in a log; under 10–50 % faults every link is made once (one link per request, none lost).
 */
const egp = (amount: string, currency = "EGP") => ({ amount, currency });
const INTEGRATIONS = { card: 4097558, wallet: 4097559 };
const request = (n: number, over: Partial<PaymentLinkRequest> = {}): PaymentLinkRequest => ({
  linkId: `link-${n}`, orderId: `order-${n}`, orderNumber: `#10${n}`, purpose: "full", amount: egp("1150.00"), methods: ["card", "wallet"],
  customer: { phone: "+201001234821", firstName: "Mona" }, notificationUrl: "https://api.mizan.test/v1/webhooks/paymob/conn-token", ...over,
});
const drift = { record: () => undefined };

describe("the intention body (E14-2a)", () => {
  it("amounts in the currency's minor units, one item for the whole, integration ids, the attempt's reference, no product data", () => {
    const b = intentionBody(request(1), 3, INTEGRATIONS);
    expect(b).toMatchObject({
      amount: 115000, currency: "EGP", payment_methods: [4097558, 4097559], items: [{ name: "Order #101", amount: 115000, quantity: 1 }],
      billing_data: { phone_number: "+201001234821", first_name: "Mona", last_name: "NA", email: "NA" }, special_reference: "order-1:full:3",
      notification_url: "https://api.mizan.test/v1/webhooks/paymob/conn-token", extras: { mizan_link: "link-1", mizan_order: "order-1", purpose: "full" },
    });
    expect(intentionBody(request(1, { amount: egp("12.500", "OMR") }), 1, INTEGRATIONS).amount).toBe(12500); // ×1000
    expect(intentionBody(request(1, { amount: egp("99.99", "SAR") }), 1, INTEGRATIONS).amount).toBe(9999);
    expect(intentionBody(request(1, { amount: egp("1.234", "KWD") }), 1, INTEGRATIONS).amount).toBe(1234);
  });

  it("refuses a method the connection has no integration for, and an amount of nothing", () => {
    expect(() => intentionBody(request(1, { methods: ["valu"] }), 1, INTEGRATIONS)).toThrow(/no Paymob integration for valu/);
    expect(() => intentionBody(request(1, { amount: egp("0.00") }), 1, INTEGRATIONS)).toThrow(/above zero/);
  });

  it("reads the answer by candidate paths: the order id from intention_order_id, else the first payment key", () => {
    expect(mapIntention({ id: "pi_1", client_secret: "s", intention_order_id: 5 }, { drift, now: Date.now })).toMatchObject({ intentionId: "pi_1", gatewayOrderId: "5", clientSecret: "s" });
    expect(mapIntention({ id: "pi_1", client_secret: "s", payment_keys: [{ order_id: 7 }] }, { drift, now: Date.now }).gatewayOrderId).toBe("7");
    expect(() => mapIntention({ id: "pi_1" }, { drift, now: Date.now })).toThrow(/clientSecret/);
  });
});

describe("error classes (E14-2a)", () => {
  const res = (status: number, body: unknown) => ({ status, json: body, text: JSON.stringify(body), headers: new Headers() }) as unknown as HttpResponse;
  it("an integration of the other mode is set-up (validation), never a retry; keys refused are auth; field errors are validation", () => {
    expect(classify("createIntention", res(404, { detail: "Integration ID/Name does not exist" }))?.kind).toBe("validation");
    expect(classify("createIntention", res(401, { detail: "Authentication credentials were not provided." }))?.kind).toBe("auth");
    expect(classify("createIntention", res(400, { billing_data: { phone_number: ["required"] } }))?.kind).toBe("validation");
    expect(classify("getTransaction", res(404, { detail: "Not found." }))?.kind).toBe("not_found");
    expect(classify("createIntention", res(503, {}))).toBeNull(); // the generic rules: retry
  });
});

function world(seed = 0, rate = 0) {
  const requests = new Map<string, PaymentLinkRequest>();
  const results = new Map<string, PaymentLinkOutcome[]>();
  const w = setupPaymob({ hooks: {
    loadPaymentLink: async (id) => requests.get(id),
    onPaymentLink: async (id, r) => { results.set(id, [...(results.get(id) ?? []), r]); },
  } }, undefined, seed);
  w.paymob.randomFaultRate = rate;
  const ask = async (r: PaymentLinkRequest) => {
    requests.set(r.linkId, r);
    await w.store.enqueue(MizanEngine.paymentLinkJob(r.linkId), w.clock.now());
  };
  return { ...w, requests, results, ask };
}

describe("payment links (E14-2a)", () => {
  it("makes an intention and hands the platform the checkout page, once", async () => {
    const w = world();
    await w.ask(request(1));
    await settle(w.engine, w.store, w.clock);
    const [r] = w.results.get("link-1")!;
    const [it] = w.paymob.byReference("order-1:full:1");
    expect(r).toEqual({ ok: true, url: `https://eg.checkout.paymob.com/?publicKey=${w.paymob.publicKey}&clientSecret=${it!.clientSecret}`, intentionId: it!.id, gatewayOrderId: String(it!.orderId), reference: "order-1:full:1" });
    // The same job again (a replay) does nothing: one job per link.
    await w.ask(request(1));
    await settle(w.engine, w.store, w.clock);
    expect(w.paymob.creates).toBe(1);
    expect(w.results.get("link-1")).toHaveLength(1);
  });

  it("a create whose answer was lost is never sent again as itself: the next attempt is a new intention, the lost one never surfaces", async () => {
    const w = world();
    w.paymob.faults.push({ path: "/v1/intention/", fault: "lost" });
    await w.ask(request(2));
    await settle(w.engine, w.store, w.clock);
    expect(w.paymob.byReference("order-2:full:1")).toHaveLength(1); // made, never seen
    expect(w.paymob.byReference("order-2:full:2")).toHaveLength(1);
    const [r] = w.results.get("link-2")!;
    expect(r).toMatchObject({ ok: true, reference: "order-2:full:2" });
  });

  it("the other mode's integration id is reported once as set-up, not retried; a withdrawn link sends nothing", async () => {
    const w = world();
    await w.ask(request(3, { methods: ["card"] }));
    w.engine.paymob!.creds.integrations = { ...w.engine.paymob!.creds.integrations, card: 9999 }; // the other mode's id
    await settle(w.engine, w.store, w.clock);
    expect(w.results.get("link-3")).toEqual([expect.objectContaining({ ok: false, reason: "validation", message: expect.stringMatching(/integration id/) })]);
    expect(w.paymob.creates).toBe(0);

    await w.store.enqueue(MizanEngine.paymentLinkJob("gone"), w.clock.now());
    await settle(w.engine, w.store, w.clock);
    expect(w.results.has("gone")).toBe(false);
  });

  it("reads with a 60-minute auth token from the API key, renewed when it runs out", async () => {
    const w = world();
    w.paymob.transactions.set("192036465", { id: 192036465, success: true, amount_cents: 115000 });
    expect(await w.engine.paymob!.getTransaction("192036465")).toMatchObject({ id: 192036465 });
    w.clock.advance(61 * 60_000);
    expect(await w.engine.paymob!.getTransaction("192036465")).toMatchObject({ success: true });
    await expect(w.engine.paymob!.getTransaction("../orders")).rejects.toThrow(/not a Paymob transaction id/);
  });

  it("never logs a key or a checkout secret", async () => {
    const w = world(1, 0.5);
    for (let n = 1; n <= 5; n++) await w.ask(request(n));
    await settle(w.engine, w.store, w.clock);
    const all = w.logs.join("\n");
    expect(all).not.toContain(w.paymob.secretKey);
    expect(all).not.toContain(w.paymob.apiKey);
    for (const it of w.paymob.intentions.values()) expect(all).not.toContain(it.clientSecret);
  });

  it.each([[0.1, 1], [0.25, 2], [0.5, 3], [0.5, 4]])("chaos at %s (seed %i): every link once, none lost, nothing dead", async (rate, seed) => {
    const w = world(seed, rate);
    w.paymob.legacyShape = seed % 2 === 0;
    for (let n = 1; n <= 20; n++) await w.ask(request(n, { purpose: n % 3 === 0 ? "deposit" : "full", amount: egp(`${100 + n}.50`) }));
    await settle(w.engine, w.store, w.clock, 2000);
    for (let n = 1; n <= 20; n++) {
      const got = w.results.get(`link-${n}`) ?? [];
      expect(got).toHaveLength(1); // once
      const r = got[0]!;
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const it = w.paymob.intentions.get(r.intentionId)!;
      expect(it.reference).toBe(r.reference); // the one handed out is the one with this reference
      expect(it.amount).toBe(Math.round((100 + n + 0.5) * 100));
      expect(r.url).toContain(`clientSecret=${it.clientSecret}`);
    }
    expect(await w.store.jobs({ status: "dead" })).toEqual([]);
  });
});
