import { describe, expect, it } from "vitest";
import type { Money } from "@mizan/shared";
import { callPrompts, callScript, CHAT_MESSAGES, chatContent, linkText, whatsappParams, type MessageFacts, type OfferFacts } from "../src/modules/confirmation/messages.js";
import type { Script } from "../src/modules/confirmation/script.js";

/**
 * What the customer reads, recorded before the script catalogue (E6-16a) moved the texts into
 * packs, and kept byte for byte since. The changes made on purpose, each pinned below:
 * - Arabic money outside EGP: "1,250 ر.س", not "1,250 SAR";
 * - the full-stop rule: the hand-sent link text no longer says "ج.م.." (nor a formal call's total);
 * - the formal pack is complete: formal stores no longer read Egyptian outside the six v1 keys;
 * - an owner's text over its key's limit has its items shortened (`fit`), as every send does now.
 */
const m = (amount: string, currency = "EGP"): Money => ({ amount, currency });
const offer = (currency = "EGP", over: Partial<OfferFacts> = {}): OfferFacts => ({
  id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0", title: "Matching scarf", qty: 1, price: m("135.00", currency), was: m("150.00", currency), message: null, newTotal: m("1385.00", currency), ...over,
});
const base = (lang: "ar" | "en", currency = "EGP"): MessageFacts => ({
  lang, store: lang === "ar" ? "متجر النيل" : "Nile Store", firstName: lang === "ar" ? "منى" : "Mona", number: "#1001",
  total: m("1250.00", currency), cod: m("1250.00", currency), link: "https://app.example/ar/c/abcdefgh",
});
const items = [{ title: "عباية سادة", quantity: 2 }, { title: "Linen shirt with a very long name that goes on and on past eighty characters wide", quantity: 1 }];

type Case = (lang: "ar" | "en") => MessageFacts;
const CASES: Record<string, Case> = {
  plain: (l) => base(l),
  no_name: (l) => ({ ...base(l), firstName: null }),
  items_city: (l) => ({ ...base(l), items, city: "مدينة نصر" }),
  paid: (l) => ({ ...base(l), cod: m("0.00") }),
  fraction: (l) => ({ ...base(l), cod: m("1250.50"), total: m("1250.50") }),
  offer: (l) => ({ ...base(l), offer: offer() }),
  offer_message: (l) => ({ ...base(l), offer: offer("EGP", { message: "🎁 خصم خاص ليك النهارده", qty: 2, was: null }) }),
  summary: (l) => ({ ...base(l), items, city: "مدينة نصر", summary: { due: m("1250.00"), more: 2 } }),
  summary_paid: (l) => ({ ...base(l), cod: m("0.00"), items, summary: { due: m("0.00") } }),
  summary_no_due: (l) => ({ ...base(l), city: "الدقي", summary: { due: null } }),
  summary_offer: (l) => ({ ...base(l), items, city: "مدينة نصر", offer: offer(), summary: { due: m("1250.00") } }),
  summary_offer_long: (l) => ({ ...base(l), items: Array.from({ length: 12 }, (_, i) => ({ title: `Item ${i} ${"x".repeat(90)}`, quantity: i + 1 })), city: "مدينة نصر", offer: offer("EGP", { message: "y".repeat(300) }), summary: { due: m("1250.00"), more: 3 } }),
};
/** Arabic money outside EGP is the one intended change (E6-16a: "ر.س", not "SAR"). */
const SAR: Record<string, Case> = {
  sar: (l) => ({ ...base(l, "SAR"), items, city: "الرياض", offer: offer("SAR"), summary: { due: m("1250.00", "SAR") } }),
};

const SCRIPTS: Record<string, Script | undefined> = {
  none: undefined,
  default: { pack: "egyptian", texts: { ar: {}, en: {} } },
  v1_egyptian: {
    pack: "egyptian",
    texts: {
      ar: {
        confirmed: "تمام يا {{customer.first_name}} ✅ {{order.number}} اتأكّد من {{store.name}}",
        change_prompt: "قولنا تعدّل إيه في {{order.items}}",
        change_received: "وصلنا يا {{customer.first_name}}، هنكلّمك.",
        cancel_prompt: "ليه عايز تلغي {{order.number}}؟",
        cancelled: "خلاص اتلغى {{order.number}} ({{order.total}}).",
        call: "أهلاً {{customer.first_name}}\n\nبنأكّد {{order.number}} بـ {{order.cod}} لـ {{order.city}}",
      },
      en: { confirmed: "Thanks {{customer.first_name}}, {{order.number}} is confirmed ({{order.cod}}).", cancelled: "Cancelled {{order.number}}." },
    },
  },
  formal: { pack: "formal", texts: { ar: {}, en: {} } },
  formal_override: { pack: "formal", texts: { ar: { cancelled: "خلاص {{order.number}}" }, en: { change_prompt: "Tell us the change." } } },
};

const record = (f: MessageFacts) => ({
  chat: Object.fromEntries(CHAT_MESSAGES.map((c) => [c, chatContent(c, f)])),
  callScript: callScript(f), callPrompts: callPrompts(f), linkText: linkText(f), whatsappParams: whatsappParams(f),
});

describe("messages golden (E6-16a baseline)", () => {
  for (const [s, script] of Object.entries(SCRIPTS)) {
    for (const [c, make] of Object.entries(CASES)) {
      for (const lang of ["ar", "en"] as const) {
        it(`${s} · ${c} · ${lang}`, () => expect(record({ ...make(lang), script })).toMatchSnapshot());
      }
    }
  }
  for (const [c, make] of Object.entries(SAR)) {
    for (const lang of ["ar", "en"] as const) {
      it(`currency · ${c} · ${lang}`, () => expect(record({ ...make(lang), script: SCRIPTS.v1_egyptian })).toMatchSnapshot());
    }
  }

  it("pins each change made on purpose", () => {
    const sar = record({ ...SAR.sar!("ar"), script: SCRIPTS.v1_egyptian });
    expect(sar.whatsappParams[3]).toBe("1,250 ر.س عند الاستلام");
    expect(linkText(CASES.plain!("ar"))).toBe("أهلاً منى، أوردرك #1001 من متجر النيل بـ 1,250 ج.م. أكّده أو عدّله من هنا: https://app.example/ar/c/abcdefgh");
    expect(record({ ...CASES.plain!("ar"), script: SCRIPTS.formal }).chat.offer_declined).toEqual({ type: "text", text: "لا بأس 🙏 سيبقى طلبك كما هو." });
    const long = record({ ...CASES.summary_offer_long!("ar"), script: SCRIPTS.v1_egyptian }).chat.change_prompt as { text: string };
    expect(long.text.length).toBeLessThanOrEqual(1000);
    expect(long.text).toContain("× 12");
  });
});
