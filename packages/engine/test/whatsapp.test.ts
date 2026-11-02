import { describe, expect, it } from "vitest";
import { DriftMonitor } from "../src/adapt/drift.js";
import { WhatsAppCloudConnector } from "../src/connectors/whatsapp/connector.js";
import { kindOfCode } from "../src/connectors/whatsapp/errors.js";
import { afterUnknownSend, parseWhatsAppWebhook, signMeta, verifyChallenge, verifyMetaSignature } from "../src/connectors/whatsapp/webhooks.js";
import { FakeClock, seeded, testRuntime } from "./fakes/clock.js";
import { FakeWhatsApp } from "./fakes/whatsapp.js";

const TO = "+201001234821";
function setupWa() {
  const clock = new FakeClock();
  const wa = new FakeWhatsApp(clock, seeded(11));
  const drift = new DriftMonitor();
  const lines: Array<Record<string, unknown>> = [];
  const rt = { ...testRuntime(clock, { [wa.host]: wa.handler }, seeded(12)), logger: { log: (_l: string, msg: string, d?: Record<string, unknown>) => { lines.push({ msg, ...d }); } } };
  const c = new WhatsAppCloudConnector({ phoneNumberId: wa.phoneNumberId, wabaId: wa.wabaId, accessToken: wa.token, baseUrl: wa.baseUrl }, rt, drift);
  const parse = () => wa.takeWebhooks().map((w) => parseWhatsAppWebhook(JSON.parse(w.body), drift, () => clock.now()));
  return { clock, wa, drift, c, lines, parse };
}

describe("WhatsApp Cloud API connector (E6-4)", () => {
  it("sends the confirmation template with quick replies; the customer's tap comes back with its payload", async () => {
    const { wa, c, parse } = setupWa();
    const r = await c.sendTemplate({ to: TO, key: "step-1", template: "mizan_order_confirm_ar", lang: "ar", params: ["منى", "#7001", "1,250 ج.م."], quickReplies: ["c1.run.confirm.sig", "c1.run.change.sig", "c1.run.cancel.sig"] });
    expect(r).toEqual({ ref: "wamid.OUT1", waId: "201001234821" });
    const sent = wa.accepted[0]!;
    expect(sent.to).toBe("201001234821");
    expect(sent.body.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "منى" }, { type: "text", text: "#7001" }, { type: "text", text: "1,250 ج.م." }] },
      { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "c1.run.confirm.sig" }] },
      { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: "c1.run.change.sig" }] },
      { type: "button", sub_type: "quick_reply", index: "2", parameters: [{ type: "payload", payload: "c1.run.cancel.sig" }] },
    ]);
    wa.tapQuickReply("201001234821", "c1.run.confirm.sig", r.ref);
    const [status, tap] = parse();
    expect(status!.statuses[0]).toMatchObject({ id: r.ref, status: "sent", key: "step-1", recipient: "201001234821", phoneNumberId: wa.phoneNumberId });
    expect(tap!.messages[0]).toMatchObject({ kind: "quick_reply", reply: "c1.run.confirm.sig", from: "201001234821", contextId: r.ref });
  });

  it("buttons, a list and text inside the window; the replies carry our ids", async () => {
    const { wa, c, parse } = setupWa();
    wa.writes("201001234821", "عايز المقاس L");
    await c.sendButtons({ to: TO, key: "offer-1", body: "عرض ليكي: طرحة مطابقة بـ 135 ج.م.", buttons: [{ id: "c1.r.offer_yes.o.s", title: "ضيفها" }, { id: "c1.r.offer_no.o.s", title: "لا شكراً" }] });
    await c.sendList({ to: TO, key: "reasons-1", body: "ممكن تقولنا السبب؟", button: "اختار السبب", rows: [{ id: "r1", title: "طلبته بالغلط" }, { id: "r2", title: "مش عايز أقول", description: "عادي" }] });
    await c.sendText({ to: TO, key: "ack-1", text: "تمام ✅" });
    expect(wa.accepted.map((m) => m.body.interactive?.type ?? m.type)).toEqual(["button", "list", "text"]);
    wa.tapReply("201001234821", "c1.r.offer_yes.o.s");
    wa.tapReply("201001234821", "r2", "list_reply");
    const parsed = parse().flatMap((p) => p.messages);
    expect(parsed.map((m) => [m.kind, m.reply ?? m.text])).toEqual([["text", "عايز المقاس L"], ["button_reply", "c1.r.offer_yes.o.s"], ["list_reply", "r2"]]);
  });

  it("a free-form message outside the 24-hour window is accepted, then fails by webhook with 131047", async () => {
    const { c, parse } = setupWa();
    const r = await c.sendButtons({ to: TO, key: "k", body: "عرض", buttons: [{ id: "a", title: "ضيفها" }] });
    const s = parse()[0]!.statuses[0]!;
    expect(s).toMatchObject({ id: r.ref, status: "failed", errorCode: 131047, key: "k" });
    expect(kindOfCode(s.errorCode)).toBe("validation");
  });

  it("classifies Meta's body codes, not the HTTP status: rate limits retry, a bad token stops, a missing template is ours to fix", async () => {
    const { wa, c, clock } = setupWa();
    wa.faults.push({ fault: "429" }, { fault: "500" });
    const t0 = clock.now();
    expect((await c.sendText({ to: TO, key: "k", text: "x" })).ref).toMatch(/^wamid/); // retried past both
    expect(clock.now()).toBeGreaterThan(t0);
    await expect(c.sendTemplate({ to: TO, key: "k2", template: "mizan_order_confirm_promo", lang: "ar", params: [], quickReplies: [] })).rejects.toMatchObject({ kind: "validation" });
    wa.pairLimit = true; // same customer again within 6 s: 131056, waited out, sent once
    const t1 = clock.now();
    await c.sendText({ to: TO, key: "k3", text: "x" });
    expect(clock.now() - t1).toBeGreaterThanOrEqual(6_000);
    expect(wa.sentWithKey("k3")).toHaveLength(1);
    wa.pairLimit = false;
    const bad = new WhatsAppCloudConnector({ phoneNumberId: wa.phoneNumberId, wabaId: wa.wabaId, accessToken: "expired", baseUrl: wa.baseUrl }, testRuntime(clock, { [wa.host]: wa.handler }), new DriftMonitor());
    await expect(bad.sendText({ to: TO, key: "k4", text: "x" })).rejects.toMatchObject({ kind: "auth", retryable: false });
    expect(kindOfCode(131026)).toBe("validation");
    expect(kindOfCode(368)).toBe("permission");
    expect(kindOfCode(999999, 503)).toBe("transient");
  });

  it("a send whose response is lost is not re-sent: the status webhook with our key proves it went out", async () => {
    const { wa, c, clock, parse } = setupWa();
    wa.faults.push({ fault: "lost" });
    const t0 = clock.now();
    await expect(c.sendText({ to: TO, key: "step-9", text: "x" })).rejects.toMatchObject({ kind: "timeout" });
    expect(wa.sentWithKey("step-9")).toHaveLength(1); // not retried by send()
    const seen = parse().some((p) => p.statuses.some((s) => s.key === "step-9"));
    expect(afterUnknownSend(t0, seen, clock.now())).toBe("sent");
    expect(afterUnknownSend(t0, false, t0 + 60_000)).toBe("wait");
    expect(afterUnknownSend(t0, false, t0 + 11 * 60_000)).toBe("resend");
  });

  it("checks Meta's limits before sending, and never logs the number in full or any text", async () => {
    const { wa, c, lines } = setupWa();
    await expect(c.sendButtons({ to: TO, key: "k", body: "x", buttons: [{ id: "a", title: "زرار عنوانه طويل جداً جداً" }] })).rejects.toMatchObject({ kind: "validation" });
    await expect(c.sendButtons({ to: TO, key: "k", body: "x", buttons: [1, 2, 3, 4].map((i) => ({ id: `b${i}`, title: "ok" })) })).rejects.toMatchObject({ kind: "validation" });
    await expect(c.sendList({ to: TO, key: "k", body: "x", button: "b", rows: [] })).rejects.toMatchObject({ kind: "validation" });
    await expect(c.sendText({ to: "0100", key: "k", text: "x" })).rejects.toMatchObject({ kind: "validation" });
    await expect(c.sendSms({ to: TO, text: "x" })).rejects.toMatchObject({ kind: "validation" });
    expect(wa.calls).toHaveLength(0);
    await c.sendText({ to: TO, key: "k", text: "أهلاً منى" });
    expect(JSON.stringify(lines)).not.toMatch(/1001234821|منى/);
  });

  it("reads template review status across pages", async () => {
    const { c } = setupWa();
    const all = await c.templates();
    expect(all.map((t) => `${t.name}:${t.status}`)).toEqual([
      "mizan_order_confirm_ar:APPROVED", "mizan_order_confirm_en:APPROVED", "mizan_order_confirm_promo:REJECTED", "old_template:PAUSED", "pending_one:PENDING",
    ]);
    expect(await c.templates(["mizan_order_confirm_ar"])).toEqual([{ name: "mizan_order_confirm_ar", language: "ar", status: "APPROVED", category: "UTILITY" }]);
  });

  it("the alternative shape: no contacts on send, ms timestamps, nested error codes", async () => {
    const { wa, c, parse, clock } = setupWa();
    wa.shape = "alt";
    const r = await c.sendButtons({ to: TO, key: "k", body: "x", buttons: [{ id: "a", title: "ok" }] });
    expect(r).toEqual({ ref: "wamid.OUT1" });
    const s = parse()[0]!.statuses[0]!;
    expect(s).toMatchObject({ status: "failed", errorCode: 131047, at: clock.now() });
  });

  it("verifies signatures and the subscription challenge; flags a status it does not know", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    expect(verifyMetaSignature(body, signMeta(body, "s3cret"), "s3cret")).toBe(true);
    expect(verifyMetaSignature(body, signMeta(body, "other"), "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, "abc", "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, undefined, "s3cret")).toBe(false);
    expect(verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "vt", "hub.challenge": "123" }, "vt")).toBe("123");
    expect(verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "123" }, "vt")).toBeNull();
    expect(verifyChallenge({ "hub.verify_token": "vt", "hub.challenge": "123" }, "vt")).toBeNull();

    const drift = new DriftMonitor();
    const p = parseWhatsAppWebhook({ entry: [{ changes: [
      { field: "account_update", value: { event: "x" } },
      { field: "messages", value: { metadata: { phone_number_id: "1" }, statuses: [{ id: "wamid.A", status: "warning", timestamp: "1700000000", recipient_id: "2010" }], messages: [{ id: "wamid.L", from: "+20 100", timestamp: "1700000000", type: "location", location: { latitude: 30.05, longitude: 31.24 } }, { id: "wamid.S", from: "2010", timestamp: "1", type: "sticker" }] } },
    ] }] }, drift, () => 0);
    expect(p.statuses[0]).toMatchObject({ status: "unknown", raw: "warning", at: 1_700_000_000_000 });
    expect(p.messages.map((m) => [m.kind, m.from])).toEqual([["location", "20100"], ["other", "2010"]]);
    expect(p.messages[0]!.location).toEqual({ lat: 30.05, lng: 31.24 });
    expect(drift.report().some((d) => d.kind === "unknown_status" && d.connector === "whatsapp")).toBe(true);
  });
});
