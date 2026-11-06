import { describe, expect, it } from "vitest";
import { DriftMonitor } from "../src/adapt/drift.js";
import { WhatsAppCloudConnector, type TemplateDraft } from "../src/connectors/whatsapp/connector.js";
import { FakeClock, json, seeded, testRuntime } from "./fakes/clock.js";
import { FakeWhatsApp } from "./fakes/whatsapp.js";

/**
 * E6-16d: the store owner submits the confirmation template to Meta from Mizan. Creating a
 * template is not idempotent at Meta: every create is looked up by name first, a duplicate-name
 * refusal reads as "exists", and an unclear outcome is verified by lookup, never re-sent blindly.
 */
function setup(intercept?: (url: URL, init: RequestInit) => Response | null) {
  const clock = new FakeClock();
  const wa = new FakeWhatsApp(clock, seeded(41));
  const handler = async (url: URL, init: RequestInit) => intercept?.(url, init) ?? wa.handler(url, init);
  const c = new WhatsAppCloudConnector({ phoneNumberId: wa.phoneNumberId, wabaId: wa.wabaId, accessToken: wa.token, baseUrl: wa.baseUrl },
    testRuntime(clock, { [wa.host]: handler }, seeded(42)), new DriftMonitor());
  const posts = () => wa.calls.filter((x) => x.method === "POST");
  return { wa, c, posts };
}

const draft = (over: Partial<TemplateDraft> = {}): TemplateDraft => ({
  name: "mizan_order_confirm_ar_gulf", language: "ar", category: "UTILITY",
  body: "👋 {{1}}\nوصلنا طلبك رقم {{3}} من {{2}}.\nالإجمالي {{4}}.\nأكّد طلبك عشان نجهّزه ونشحنه لك.",
  example: ["أهلاً منى", "متجر النيل", "#1001", "1,250 ج.م. عند الاستلام"], buttons: ["أكّد الطلب", "أبي أعدّل", "ألغِ الطلب"], ...over,
});
const metaError = (status: number, code: number, subcode?: number) => json(status, { error: { message: "(#x) fake", type: "OAuthException", code, ...(subcode ? { error_subcode: subcode } : {}) } });
const isCreate = (url: URL, init: RequestInit) => init.method === "POST" && url.pathname.endsWith("/message_templates");

describe("creating the confirmation template in the store's account (E6-16d)", () => {
  it("posts the body with its example and three quick replies, and reads id, status and category back", async () => {
    const { wa, c, posts } = setup();
    const r = await c.createTemplate(draft());
    expect(r).toEqual({ id: expect.any(String), name: "mizan_order_confirm_ar_gulf", language: "ar", status: "PENDING", category: "UTILITY", existed: false });
    expect(wa.createdTemplates).toHaveLength(1);
    expect(wa.createdTemplates[0]!.components).toEqual([
      { type: "BODY", text: draft().body, example: { body_text: [draft().example] } },
      { type: "BUTTONS", buttons: draft().buttons.map((text) => ({ type: "QUICK_REPLY", text })) },
    ]);
    expect(posts()).toEqual([{ method: "POST", path: `${wa.wabaId}/message_templates` }]);
  });

  it("looks the name up first: a template that exists is returned, never created twice (rule 5)", async () => {
    const { wa, c, posts } = setup();
    const first = await c.createTemplate(draft());
    expect(await c.createTemplate(draft())).toMatchObject({ id: first.id, name: first.name, status: "PENDING", existed: true });
    // Meta's name filter matches part of a name: the Egyptian one is found exactly, not the formal or Gulf one.
    expect(await c.createTemplate(draft({ name: "mizan_order_confirm_ar" }))).toMatchObject({ name: "mizan_order_confirm_ar", status: "APPROVED", existed: true });
    expect(wa.createdTemplates).toHaveLength(1);
    expect(posts()).toHaveLength(1);
  });

  it("Meta's duplicate-name refusal (created meanwhile in WhatsApp Manager) reads as 'exists'", async () => {
    let raced = false;
    const { wa, c } = setup((url, init) => {
      if (!raced && isCreate(url, init)) {
        raced = true; // someone creates it between our lookup and our create
        wa.templates.push({ id: "77", name: "mizan_order_confirm_ar_gulf", language: "ar", status: "APPROVED", category: "UTILITY" });
      }
      return null;
    });
    expect(await c.createTemplate(draft())).toMatchObject({ id: "77", status: "APPROVED", existed: true });
    expect(wa.createdTemplates).toHaveLength(0);
  });

  it("a duplicate-name refusal with nothing found (the name is being deleted) is ours to fix, not retried", async () => {
    const { c } = setup((url, init) => (isCreate(url, init) ? metaError(400, 100, 2388023) : null));
    expect(await c.createTemplate(draft()).catch((e: unknown) => e)).toMatchObject({ kind: "validation", retryable: false });
  });

  it("a create whose response is lost is verified by lookup, never sent again blindly", async () => {
    let lost = false;
    const { wa, c, posts } = setup((url, init) => {
      if (isCreate(url, init) && !lost) { lost = true; wa.faults.push({ fault: "lost" }); } // accepted, the answer lost
      return null;
    });
    wa.faults = [{ path: `${wa.wabaId}/message_templates`, fault: "timeout" }]; // the first lookup hangs (a GET: retried)
    expect(await c.createTemplate(draft())).toMatchObject({ name: "mizan_order_confirm_ar_gulf", status: "PENDING", existed: true });
    expect(wa.createdTemplates).toHaveLength(1);
    expect(posts()).toHaveLength(1);
  });

  it("a 5xx on the create is not re-sent inside the call: the lookup finds nothing and the job retries later", async () => {
    let creates = 0;
    const { wa, c } = setup((url, init) => (isCreate(url, init) ? (creates++, metaError(500, 131000)) : null));
    expect(await c.createTemplate(draft()).catch((e: unknown) => e)).toMatchObject({ kind: "transient", retryable: true });
    expect(creates).toBe(1);
    expect(wa.createdTemplates).toHaveLength(0);
  });

  it("a throttled create was never processed: retried at once, created once", async () => {
    let throttled = 0;
    const { wa, c } = setup((url, init) => (isCreate(url, init) && throttled < 2 ? (throttled++, metaError(400, 130429)) : null));
    expect((await c.createTemplate(draft())).existed).toBe(false);
    expect(throttled).toBe(2);
    expect(wa.createdTemplates).toHaveLength(1);
  });

  it("checks what Meta refuses before any call: a body that starts or ends with a variable, examples, the name, button length", async () => {
    const { c, posts } = setup();
    for (const bad of [
      draft({ body: "{{1}} وصلنا طلبك {{2}} {{3}} {{4}}." }), draft({ body: "👋 {{1}} {{2}} {{3}} {{4}}" }), draft({ example: ["a"] }),
      draft({ name: "Bad Name" }), draft({ buttons: ["x".repeat(26), "b", "c"] }), draft({ buttons: [] }),
    ]) expect(await c.createTemplate(bad).catch((e: unknown) => e)).toMatchObject({ kind: "validation" });
    expect(posts()).toHaveLength(0);
  });

  it("classifies Meta's refusals: 100 is ours to fix, 190 a refused token, 200 and 10 a missing permission", async () => {
    for (const [status, code, kind] of [[400, 100, "validation"], [401, 190, "auth"], [403, 200, "permission"], [403, 10, "permission"]] as const) {
      const { wa, c } = setup((url, init) => (isCreate(url, init) ? metaError(status, code) : null));
      expect(await c.createTemplate(draft()).catch((e: unknown) => e), `${code}`).toMatchObject({ kind, retryable: false });
      expect(wa.createdTemplates).toHaveLength(0);
    }
  });

  it("a rejected template submitted again is edited back into review, never created twice; without the option it is only read", async () => {
    const { wa, c, posts } = setup();
    wa.rejectOnReview.set("mizan_order_confirm_ar_gulf", "INVALID_FORMAT");
    wa.reviewAfter = 1;
    const first = await c.createTemplate(draft());
    await c.templates(["mizan_order_confirm_ar_gulf"]); // reviewed: rejected
    expect(await c.createTemplate(draft())).toMatchObject({ status: "REJECTED", existed: true });
    expect(wa.editedTemplates).toEqual([]);
    wa.rejectOnReview.delete("mizan_order_confirm_ar_gulf");
    expect(await c.createTemplate(draft(), { resubmitRejected: true })).toMatchObject({ id: first.id, status: "PENDING", existed: true });
    expect(wa.editedTemplates).toEqual([first.id]);
    expect(wa.createdTemplates).toHaveLength(1);
    expect(posts().filter((p) => p.path.endsWith("message_templates"))).toHaveLength(1);
    expect((await c.templates(["mizan_order_confirm_ar_gulf"]))[0]).toMatchObject({ status: "APPROVED" });
  });

  it("review: PENDING, then APPROVED after a few checks or REJECTED with Meta's reason; Meta may file it under another category", async () => {
    const { wa, c } = setup();
    wa.rejectOnReview.set("mizan_order_confirm_ar_formal", "INVALID_FORMAT");
    wa.recategorize.set("mizan_order_confirm_ar_gulf", "MARKETING");
    expect((await c.createTemplate(draft())).category).toBe("MARKETING");
    await c.createTemplate(draft({ name: "mizan_order_confirm_ar_formal" }));
    const statuses = async () => Object.fromEntries((await c.templates(["mizan_order_confirm_ar_gulf", "mizan_order_confirm_ar_formal"]))
      .map((t) => [t.name, `${t.status}${t.rejectedReason ? `:${t.rejectedReason}` : ""}`]));
    // Reviewed after two listings each (the lookups before each create count).
    expect(await statuses()).toEqual({ mizan_order_confirm_ar_gulf: "APPROVED", mizan_order_confirm_ar_formal: "PENDING" });
    expect(await statuses()).toEqual({ mizan_order_confirm_ar_gulf: "APPROVED", mizan_order_confirm_ar_formal: "REJECTED:INVALID_FORMAT" });
  });
});
