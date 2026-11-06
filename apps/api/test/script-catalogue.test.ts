import { describe, expect, it } from "vitest";
import { WHATSAPP_LIMITS } from "@mizan/engine";
import { BUYER_CANCEL_REASONS, MAX_BUYER_REASONS } from "@mizan/shared";
import { CHAT_MESSAGES, chatContent, whatsappParams, type MessageFacts } from "../src/modules/confirmation/messages.js";
import { estimateLength, KEY_SPEC, PACK_REASONS, PACK_TEXTS, PACKS, SCRIPT_KEYS, validateScript, variablesIn, type Script } from "../src/modules/confirmation/script.js";
import { scriptCatalogue } from "../src/modules/confirmation/script/view.js";

/** E6-16a: every pack is complete and safe, and the worst real order still fits WhatsApp's limits. */
describe("script catalogue", () => {
  it.each(PACKS.flatMap((p) => (["ar", "en"] as const).map((l) => [p, l] as const)))("%s · %s: every key present, within its limit, its variables allowed and required ones there", (pack, lang) => {
    const texts = PACK_TEXTS[pack][lang];
    for (const key of SCRIPT_KEYS) {
      const s = KEY_SPEC[key];
      const t = texts[key];
      // Composed keys (the call script) are built in code, in each pack's words.
      if (s.optional || s.composed) { expect(t, `${pack}.${lang}.${key}`).toBeUndefined(); continue; }
      expect(t?.trim(), `${pack}.${lang}.${key}`).toBeTruthy();
      expect(estimateLength(t!, "x".repeat(60)), `${pack}.${lang}.${key}`).toBeLessThanOrEqual(s.limit);
      for (const v of variablesIn(t!)) expect(s.vars, `${pack}.${lang}.${key}: ${v}`).toContain(v);
      for (const v of s.required) expect(variablesIn(t!), `${pack}.${lang}.${key}`).toContain(v);
    }
    // The pack's own wording, saved as if the owner wrote it, breaks no rule.
    const script: Script = { pack, texts: { ar: lang === "ar" ? { ...texts } : {}, en: lang === "en" ? { ...texts } : {} } };
    expect(validateScript(script, { storeName: "x".repeat(60), storeLang: lang })).toEqual([]);
  });

  it("each pack has the five canonical reasons, titles unique with the keep row, in both languages", () => {
    for (const pack of PACKS) {
      expect(PACK_REASONS[pack].map((r) => r.code)).toEqual([...BUYER_CANCEL_REASONS]);
      for (const lang of ["ar", "en"] as const) {
        const titles = [...PACK_REASONS[pack].map((r) => r.title[lang]!), PACK_TEXTS[pack][lang].keep_title!];
        expect(new Set(titles).size).toBe(titles.length);
        for (const t of titles) expect(t.length).toBeLessThanOrEqual(24);
      }
    }
  });

  it("the catalogue the editor reads is static, with an ETag", () => {
    const a = scriptCatalogue();
    expect(a).toBe(scriptCatalogue());
    expect(a.etag).toMatch(/^"[\w-]{20,}"$/);
    expect(a.body.keys.map((k) => k.key)).toEqual([...SCRIPT_KEYS]);
    expect(a.body.keys.find((k) => k.key === "call")).toMatchObject({ composed: true, group: "calls" });
    expect(a.body.maxReasons).toBe(MAX_BUYER_REASONS);
    expect(a.body.templateText.ar.buttons).toHaveLength(3);
    // E6-16d: every variant; the deprecated templateText keeps the store-independent defaults.
    expect(a.body.templates.map((t) => `${t.variant}:${t.name}:${t.lang}`)).toEqual([
      "ar_egyptian:mizan_order_confirm_ar:ar", "ar_formal:mizan_order_confirm_ar_formal:ar", "ar_gulf:mizan_order_confirm_ar_gulf:ar", "en:mizan_order_confirm_en:en",
    ]);
    expect(a.body.templateText.ar.body).toBe(a.body.templates[0]!.body);
    expect(a.body.templateText.en.body).toBe(a.body.templates[3]!.body);
  });
});

describe("the worst real order still fits WhatsApp", () => {
  const long = (n: number, c = "ع") => c.repeat(n);
  const reasons = Array.from({ length: MAX_BUYER_REASONS }, (_, i) => ({
    id: `r${i}`, code: BUYER_CANCEL_REASONS[i % 5]!, title: { ar: `${long(20)} ${i}`.slice(0, 24), en: `${"w".repeat(20)} ${i}`.slice(0, 24) }, description: { ar: long(72), en: "d".repeat(72) },
  }));
  const cases = PACKS.flatMap((pack) => (["ar", "en"] as const).map((lang) => [pack, lang] as const));

  it.each(cases)("%s · %s", (pack, lang) => {
    const script: Script = {
      version: 2, pack, cancelReasons: reasons,
      texts: { ar: { cancel_header: `${long(40)} {{order.number}}`, footer: long(59), cancel_section: long(24), keep_description: long(72) }, en: { cancel_header: `${"h".repeat(40)} {{order.number}}`, footer: "f".repeat(59), cancel_section: "s".repeat(24), keep_description: "k".repeat(72) } },
    };
    const money = (amount: string) => ({ amount, currency: "EGP" });
    const f: MessageFacts = {
      lang, store: long(60, "S"), firstName: long(30, "N"), number: "#1234567890123456", total: money("1234567.89"), cod: money("1234567.89"), link: "https://app.example/ar/c/abcdefghijklmnopqrstuvwxyz0123456789",
      items: Array.from({ length: 10 }, (_, i) => ({ title: `${long(117, "T")} ${i}`, quantity: 99 })), city: long(40, "C"),
      offer: { id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0", title: long(60, "O"), qty: 9, price: money("99999.99"), was: money("199999.99"), message: long(300, "M"), newTotal: money("2234567.88") },
      summary: { due: money("1234567.89"), more: 40 }, script,
    };
    for (const m of CHAT_MESSAGES) {
      for (const offer of [f.offer, null]) {
        const c = chatContent(m, { ...f, offer });
        const at = `${m}${offer ? "" : " (no offer)"}`;
        if (c.type === "text") {
          expect(c.text.trim(), at).toBeTruthy();
          expect([...c.text].length, at).toBeLessThanOrEqual(WHATSAPP_LIMITS.text);
          continue;
        }
        expect(c.body.trim(), at).toBeTruthy();
        expect(c.body.length, at).toBeLessThanOrEqual(WHATSAPP_LIMITS.body);
        if (c.header) expect(c.header.text.length, at).toBeLessThanOrEqual(WHATSAPP_LIMITS.header);
        if (c.footer) expect(c.footer.length, at).toBeLessThanOrEqual(WHATSAPP_LIMITS.footer);
        if (c.type === "buttons") {
          expect(c.buttons.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.buttons);
          for (const b of c.buttons) { expect(b.title.trim()).toBeTruthy(); expect(b.title.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.buttonTitle); }
          expect(new Set(c.buttons.map((b) => b.title)).size).toBe(c.buttons.length);
        } else {
          expect(c.rows.length).toBe(WHATSAPP_LIMITS.rows);
          expect(c.button.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.listButton);
          if (c.section) expect(c.section.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.section);
          for (const r of c.rows) {
            expect(r.title.trim()).toBeTruthy();
            expect(r.title.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.rowTitle);
            if (r.description) expect(r.description.length).toBeLessThanOrEqual(WHATSAPP_LIMITS.rowDescription);
          }
          expect(new Set(c.rows.map((r) => r.title)).size).toBe(c.rows.length);
        }
      }
    }
    for (const p of whatsappParams(f)) expect(p).not.toMatch(/[\n\t]| {4}/);
  });
});
