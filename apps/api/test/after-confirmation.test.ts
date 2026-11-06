import { describe, expect, it } from "vitest";
import { chatContent } from "../src/modules/confirmation/messages.js";
import { afterConfirmationSettings, AfterConfirmationSchema, DEFAULT_AFTER, type AfterConfirmation } from "@mizan/shared";
import { autoBookIntent, decideNoAnswerCancel, decideRelease, MAX_DEFERRALS } from "../src/modules/confirmation/after/decide.js";

const on = (patch: (s: AfterConfirmation) => void): AfterConfirmation => { const s = structuredClone(DEFAULT_AFTER); patch(s); return s; };
const booking = on((s) => { s.confirmed.autoBook.enabled = true; });
const order = (over: Partial<Parameters<typeof decideRelease>[0]["order"]> = {}) => ({ status: "confirmed", paymentMode: "cod", stockStatus: null, duplicateStatus: null, holdReason: null, ...over });
const release = (over: Partial<Parameters<typeof decideRelease>[0]> = {}) => decideRelease({ order: order(), autoBook: true, deferrals: 0, settling: false, offerProposed: false, settings: booking, ...over });

describe("after-confirmation settings", () => {
  it("default to nothing changing, and a broken section falls back to its default alone", () => {
    expect(afterConfirmationSettings({})).toEqual(DEFAULT_AFTER);
    expect(afterConfirmationSettings({ afterConfirmation: "nope" })).toEqual(DEFAULT_AFTER);
    const s = afterConfirmationSettings({ afterConfirmation: { confirmed: { broken: true }, cancelled: { tags: ["refused"], notify: { enabled: true, roles: ["owner"] } } } });
    expect(s.confirmed).toEqual(DEFAULT_AFTER.confirmed);
    expect(s.cancelled.tags).toEqual(["refused"]);
  });

  it("cannot express an unknown payment method or an exchange as something that books by itself (rule 13)", () => {
    const bad = (patch: (s: Record<string, any>) => void) => { const s = structuredClone(DEFAULT_AFTER) as Record<string, any>; patch(s); return AfterConfirmationSchema.safeParse(s).success; };
    expect(bad((s) => { s.confirmed.autoBook.paymentModes = ["unknown"]; })).toBe(false);
    expect(bad((s) => { s.confirmed.autoBook.channels = ["exchange"]; })).toBe(false);
    expect(bad((s) => { s.confirmed.graceMinutes = 121; })).toBe(false);
    expect(bad(() => {})).toBe(true);
  });
});

describe("releasing a confirmed order", () => {
  it("never books what moved, what the customer is holding, an unknown or unchosen payment, short stock or a suspected duplicate", () => {
    expect(release({ order: order({ status: "cancelled" }) })).toEqual({ kind: "skip", code: "order_moved" });
    expect(release({ order: order({ holdReason: "customer_message" }) })).toEqual({ kind: "skip", code: "held_by_customer" });
    expect(release({ order: order({ paymentMode: "unknown" }) })).toEqual({ kind: "blocked", code: "payment_mode_not_allowed" });
    expect(release({ order: order({ paymentMode: "bank_transfer" }) })).toEqual({ kind: "blocked", code: "payment_mode_not_allowed" });
    expect(release({ order: order({ stockStatus: "short" }) })).toEqual({ kind: "blocked", code: "stock_short" });
    expect(release({ order: order({ duplicateStatus: "suspected" }) })).toEqual({ kind: "blocked", code: "duplicate_suspected" });
  });

  it("stock not reserved yet is not enough stock: it waits, then stops with why", () => {
    expect(release({ stockPending: true })).toEqual({ kind: "defer" });
    expect(release({ stockPending: true, deferrals: MAX_DEFERRALS })).toEqual({ kind: "blocked", code: "stock_settling" });
    expect(release({ stockPending: true, autoBook: false })).toEqual({ kind: "released", code: "released" }); // only booking needs it
  });

  it("waits while an offer or edit is being applied, then lets go without booking", () => {
    expect(release({ settling: true })).toEqual({ kind: "defer" });
    expect(release({ settling: true, deferrals: MAX_DEFERRALS })).toEqual({ kind: "released", code: "offer_settling" });
  });

  it("books only when the follow-up asked to and the live setting still says so (off wins)", () => {
    expect(release()).toEqual({ kind: "book", expireOffer: false });
    expect(release({ offerProposed: true })).toEqual({ kind: "book", expireOffer: true });
    expect(release({ autoBook: false })).toEqual({ kind: "released", code: "released" });
    expect(release({ settings: DEFAULT_AFTER })).toEqual({ kind: "released", code: "setting_off" });
  });

  it("books by itself only for the chosen ways of confirming, and after a change only when asked", () => {
    expect(autoBookIntent(DEFAULT_AFTER, "whatsapp", false)).toBe(false);
    expect(autoBookIntent(booking, "whatsapp", false)).toBe(true);
    expect(autoBookIntent(booking, "whatsapp", true)).toBe(false);
    expect(autoBookIntent(on((s) => { s.confirmed.autoBook.enabled = true; s.confirmed.autoBook.afterChange = true; }), "whatsapp", true)).toBe(true);
    expect(autoBookIntent(on((s) => { s.confirmed.autoBook.enabled = true; s.confirmed.autoBook.channels = ["whatsapp"]; }), "auto", false)).toBe(false);
    expect(autoBookIntent(booking, "exchange", false)).toBe(false);
  });
});

describe("cancelling an order nobody answered", () => {
  const cancelling = on((s) => { s.noAnswer.autoCancel.enabled = true; });
  const waiting = { status: "needs_agent", outcome: "no_reply", reason: "unreachable" };
  const fresh: { status: string; paidMinor: bigint; assignedTo: string | null } = { status: "pending_confirmation", paidMinor: 0n, assignedTo: null };
  const decide = (over: { settings?: AfterConfirmation; run?: typeof waiting | null; order?: Partial<typeof fresh> & { assignedTo?: string | null } } = {}) =>
    decideNoAnswerCancel({ settings: over.settings ?? cancelling, run: over.run === undefined ? waiting : over.run, order: { ...fresh, ...over.order } });

  it("cancels only when every guard holds", () => {
    expect(decide()).toEqual({ cancel: true });
    expect(decide({ settings: DEFAULT_AFTER })).toEqual({ cancel: false, code: "setting_off" });
    expect(decide({ run: null })).toEqual({ cancel: false, code: "run_finished" });
    expect(decide({ run: { ...waiting, outcome: "changed" } })).toEqual({ cancel: false, code: "answered" });
    for (const reason of ["hold", "high_risk", "change_requested", "customer_message"]) expect(decide({ run: { ...waiting, reason } })).toEqual({ cancel: false, code: "person_decides" });
    expect(decide({ order: { status: "confirmed" } })).toEqual({ cancel: false, code: "order_moved" });
    expect(decide({ order: { paidMinor: 5000n } })).toEqual({ cancel: false, code: "paid" });
    expect(decide({ order: { assignedTo: "u-1" } })).toEqual({ cancel: false, code: "assigned" });
    // After the team's own last call the caller is the one assigned: not someone holding it.
    expect(decideNoAnswerCancel({ settings: cancelling, stage: "team_calls", run: waiting, order: { ...fresh, assignedTo: "u-1" } })).toEqual({ cancel: true });
    expect(decideNoAnswerCancel({ settings: on((s) => { s.noAnswer.autoCancel.enabled = true; s.noAnswer.autoCancel.cancelIfAssigned = true; }), run: waiting, order: { ...fresh, assignedTo: "u-1" } })).toEqual({ cancel: true });
  });
});

describe("the order summary after confirming (E6-23a)", () => {
  const base = { lang: "en" as const, store: "Nile", firstName: "Mona", number: "#1042", cod: { amount: "1250.00", currency: "EGP" }, total: { amount: "1250.00", currency: "EGP" }, link: "", items: [{ title: "Abaya", quantity: 2 }], city: "Nasr City" };
  it("lists the items, what the courier collects (from cashToCollect), the area and what comes next; never a phone or address", () => {
    const text = (chatContent("confirmed", { ...base, summary: { due: { amount: "1000.00", currency: "EGP" } } }) as { text: string }).text;
    expect(text).toContain("• 2× Abaya");
    expect(text).toMatch(/Pay the courier: .*1,000/);
    expect(text).toContain("📍 Nasr City");
    expect(text).toContain("tracking number");
    expect(text).not.toMatch(/\+?20\d{9,}|Abbas/);
  });
  it("paid says paid; unknown leaves the money out; no summary unless chosen; Arabic too", () => {
    expect((chatContent("confirmed", { ...base, summary: { due: { amount: "0.00", currency: "EGP" } } }) as { text: string }).text).toContain("💳 Paid");
    const unknown = (chatContent("confirmed", { ...base, summary: { due: null } }) as { text: string }).text;
    expect(unknown).not.toMatch(/Pay the courier|Paid/);
    expect((chatContent("confirmed", base) as { text: string }).text).not.toContain("•");
    expect((chatContent("confirmed", { ...base, lang: "ar", summary: { due: { amount: "1000.00", currency: "EGP" } } }) as { text: string }).text).toContain("هتدفع للمندوب");
  });
});
