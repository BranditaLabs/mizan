import { describe, expect, it } from "vitest";
import { callScript, chatContent, money, reasonOf, type MessageFacts } from "../src/modules/confirmation/messages.js";
import { confirmationSettings, DEFAULT_CONFIRMATION } from "../src/modules/confirmation/confirmation.settings.js";
import {
  estimateLength, fit, PACK_TEXTS, readScript, render, ScriptSchema, scriptIssues, scriptText, validateScript, type Issue, type Script,
} from "../src/modules/confirmation/script.js";

/** E6-5, E6-16a: the store's own wording, variables from the order, packs, rules and the tolerant reader. */
const egp = (amount: string) => ({ amount, currency: "EGP" });
const facts = (over: Partial<MessageFacts> = {}): MessageFacts => ({
  lang: "ar", store: "متجر النيل", firstName: "منى", number: "#1001", total: egp("1250.00"), cod: egp("1250.00"), link: "",
  items: [{ title: "عباية سادة", quantity: 2 }], city: "مدينة نصر", ...over,
});
const text = (c: ReturnType<typeof chatContent>) => (c.type === "text" ? c.text : c.body);
const draft = (ar: Script["texts"]["ar"] = {}, en: Script["texts"]["en"] = {}, more: Partial<Script> = {}): Script => ({ pack: "egyptian", texts: { ar, en }, ...more });
const ctx = { storeName: "متجر النيل", storeLang: "ar" as const };
const codes = (issues: Issue[]) => issues.map((i) => `${i.path.join(".")}:${i.code}`);

describe("confirmation script (E6-5)", () => {
  it("fills variables from the order, never more than the messages show", () => {
    expect(render("أهلاً {{customer.first_name}}، أوردرك {{ order.number }} بـ {{order.cod}}: {{order.items}} لـ {{order.city}} من {{store.name}}", facts()))
      .toBe("أهلاً منى، أوردرك #1001 بـ 1,250 ج.م. عند الاستلام: عباية سادة × 2 لـ مدينة نصر من متجر النيل");
    expect(render("Paid: {{order.cod}}, total {{order.total}}", facts({ lang: "en", cod: egp("0.00") }))).toBe("Paid: EGP 1,250, total EGP 1,250");
    expect(render("{{customer.first_name}}", facts({ firstName: null }))).toBe("حضرتك");
    expect(render("{{customer.greeting}} / {{order.due}}", facts({ firstName: null }))).toBe("أهلاً بيك / 1,250 ج.م.");
  });

  it("refuses variables it doesn't know (an address or phone is never one)", () => {
    const bad = ScriptSchema.safeParse(draft({ confirmed: "تم {{customer.phone}}" }));
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]).toMatchObject({ path: ["texts", "ar", "confirmed"], message: "unknown_variable" });
    expect(codes(validateScript(draft({}, { cancelled: "{{customer.address}} gone" }), ctx))).toEqual(["texts.en.cancelled:unknown_variable"]);
  });

  it("the owner's wording answers each button; what they left empty keeps the pack's", () => {
    const script = draft({ confirmed: "تمام يا {{customer.first_name}} ✅ {{order.number}} اتأكّد", cancel_prompt: "ليه عايز تلغي؟" });
    const f = facts({ script });
    expect(text(chatContent("confirmed", f))).toBe("تمام يا منى ✅ #1001 اتأكّد");
    expect(text(chatContent("cancel_reasons", f))).toBe("ليه عايز تلغي؟");
    expect(text(chatContent("change_prompt", f))).toContain("اكتب لنا التعديل"); // the Egyptian pack
    expect(text(chatContent("confirmed", facts({ lang: "en", script })))).toContain("Done ✅"); // English untouched
  });

  it("the formal pack speaks formal Arabic; the owner's text still wins; English is the same in every pack", () => {
    const formal = draft({}, {}, { pack: "formal" });
    expect(text(chatContent("confirmed", facts({ script: formal })))).toBe("تم ✅ تأكيد طلبك #1001 وسيتم شحنه قريباً. شكراً لاختيارك متجر النيل.");
    expect(text(chatContent("offer_declined", facts({ script: formal })))).toBe("لا بأس 🙏 سيبقى طلبك كما هو.");
    expect(scriptText({ ...formal, texts: { ar: { cancelled: "خلاص" }, en: {} } }, "ar", "cancelled")).toBe("خلاص");
    expect(scriptText(formal, "en", "cancelled")).toBe(PACK_TEXTS.egyptian.en.cancelled);
    expect(scriptText(draft(), "ar", "call")).toBeNull(); // composed: code's lines
    expect(scriptText(draft(), "ar", "footer")).toBeNull(); // optional: left out
  });

  it("the gulf pack speaks Gulf Arabic, with its own greeting and reasons", () => {
    const gulf = facts({ script: draft({}, {}, { pack: "gulf" }) });
    expect(text(chatContent("confirmed", gulf))).toBe("تم ✅ طلبك #1001 تأكّد وبنشحنه لك قريب. شكراً لأنك اخترت متجر النيل!");
    expect(render("{{customer.greeting}}", gulf)).toBe("هلا منى");
    const list = chatContent("cancel_reasons", gulf);
    expect(list.type === "list" && list.rows.map((r) => r.title)).toEqual(["غيّرت رأيي", "طلبته بالغلط", "لقيته أرخص", "التوصيل بيتأخر علي", "سبب ثاني", "لا، كمّل الطلب"]);
  });

  it("the call script is the owner's lines, with the offer still at the end", () => {
    const script = draft({ call: "أهلاً {{customer.first_name}}\n\nبنأكّد {{order.number}} بـ {{order.cod}}" });
    const offer = { id: "o1", title: "طرحة", qty: 1, price: egp("135.00"), was: egp("150.00"), message: null, newTotal: egp("1385.00") };
    expect(callScript(facts({ script }))).toEqual(["أهلاً منى", "بنأكّد #1001 بـ 1,250 ج.م. عند الاستلام"]);
    expect(callScript(facts({ script, offer })).at(-1)).toContain("طرحة بـ 135 ج.م. بدل 150 ج.م.");
  });
});

describe("the script's rules (E6-16a)", () => {
  it.each(["ar", "en"] as const)("every rule, with its exact path (%s)", (lang) => {
    const t = (texts: Script["texts"]["ar"]) => codes(validateScript(lang === "ar" ? draft(texts) : draft({}, texts), ctx));
    expect(t({ btn_offer_yes: "x".repeat(21) })).toEqual([`texts.${lang}.btn_offer_yes:too_long`]);
    expect(t({ btn_offer_yes: "Add {{order.number}}" })).toEqual([`texts.${lang}.btn_offer_yes:no_variables_in_titles`]);
    expect(t({ keep_title: "{{store.name}}" })).toEqual([`texts.${lang}.keep_title:no_variables_in_titles`, `texts.${lang}.keep_title:only_variables`]);
    expect(t({ offer_question: "{{order.number}} ok?" })).toEqual([`texts.${lang}.offer_question:variable_not_here`]);
    expect(t({ link_text: "Confirm: soon" })).toEqual([`texts.${lang}.link_text:missing_variable`]);
    expect(t({ opted_out: "Bye from {{store.name}}" })).toEqual([`texts.${lang}.opted_out:missing_variable`]);
    expect(t({ summary_pay: "Pay now" })).toEqual([`texts.${lang}.summary_pay:missing_variable`]);
    expect(t({ confirmed: "{{order.number}} {{order.total}}" })).toEqual([`texts.${lang}.confirmed:only_variables`]);
    expect(t({ offer_pitch: "Line one\nline two {{offer.line}}" })).toEqual([`texts.${lang}.offer_pitch:no_new_lines`]);
    expect(t({ footer: "See shop.example.com" })).toEqual([`texts.${lang}.footer:no_links`]);
    expect(t({ opted_in: "Back: https://x.example/y {{store.name}}" })).toEqual([`texts.${lang}.opted_in:no_links`]);
    expect(t({ on_delivery: "on delivery https://x.example" })).toEqual([`texts.${lang}.on_delivery:no_links`, `texts.${lang}.on_delivery:template_safe`]);
    expect(t({ on_delivery: "call 0100123456" })).toEqual([`texts.${lang}.on_delivery:template_safe`]);
    expect(t({ on_delivery: "on delivery 🚚" })).toEqual([`texts.${lang}.on_delivery:template_safe`]);
    expect(t({ on_delivery: "on    delivery" })).toEqual([`texts.${lang}.on_delivery:template_safe`]);
    expect(t({ btn_offer_yes: "Same", btn_offer_no: "same" })).toEqual([`texts.${lang}.btn_offer_no:duplicate_title`]);
    expect(t({ confirmed: "Thanks {{customer.first_name}}" })).toEqual([]);
  });

  it("counts variables at their width and the store's name at its real length", () => {
    expect(estimateLength("{{order.items}}")).toBe(200);
    expect(estimateLength("{{store.name}}!", "Nile")).toBe(5);
    const long = draft({ cancel_header: `${"x".repeat(50)} {{store.name}}` });
    expect(codes(validateScript(long, { storeName: "Nile", storeLang: "ar" }))).toEqual([]);
    expect(codes(validateScript(long, { storeName: "A store with a long name", storeLang: "ar" }))).toEqual(["texts.ar.cancel_header:too_long"]);
  });

  it("reasons: at most nine, unique ids and titles after the pack fills in, the store's language required", () => {
    const r = (id: string, code: string, title: Record<string, string>) => ({ id, code, title }) as NonNullable<Script["cancelReasons"]>[number];
    expect(ScriptSchema.safeParse(draft({}, {}, { cancelReasons: Array.from({ length: 10 }, (_, i) => r(`r${i}`, "other", { ar: `سبب ${i}` })) })).success).toBe(false);
    expect(ScriptSchema.safeParse(draft({}, {}, { cancelReasons: [r("wrong-size", "other", { ar: "x" })] })).success).toBe(false); // no "-" in an id
    const s = draft({}, {}, { cancelReasons: [r("wrong_size", "changed_mind", { ar: "المقاس غلط" }), r("wrong_size", "other", { en: "Late" }), r("late", "other", { ar: "المقاس غلط", en: "Other" })] });
    expect(codes(validateScript(s, ctx))).toEqual([
      "cancelReasons.1.id:duplicate_id", "cancelReasons.1.title.ar:reason_title_required",
      "cancelReasons.2.title.ar:duplicate_title", // same Arabic title as the first
    ]);
    // English falls back to the pack's title for the code: two "changed_mind" reasons without English collide.
    const fallback = draft({}, {}, { cancelReasons: [r("a", "changed_mind", { ar: "أ" }), r("b", "changed_mind", { ar: "ب" })] });
    expect(codes(validateScript(fallback, ctx))).toEqual(["cancelReasons.1.title.en:duplicate_title"]);
    expect(codes(validateScript(draft({ keep_title: "غيّرت رأيي" }), ctx))).toEqual(["texts.ar.keep_title:duplicate_title"]);
    expect(codes(validateScript(draft({}, {}, { cancelReasons: [r("x", "other", { ar: "Call {{store.name}}" })] }), ctx))).toEqual(["cancelReasons.0.title.ar:no_variables_in_titles"]);
  });
});

describe("fit and the full stop", () => {
  it("never splits a grapheme, never cuts a link, falls back to the pack's text, never returns empty", () => {
    expect(fit("short", 10, "pack")).toBe("short");
    expect(fit("x".repeat(30), 10, "pack text")).toBe("pack text");
    const family = "👨‍👩‍👧".repeat(5); // 8 code units each
    const cut = fit(family, 20, null);
    expect(cut).toBe("👨‍👩‍👧👨‍👩‍👧…");
    expect(fit("see https://example.com/very/long/link/to/somewhere", 30, null)).toBe("see…");
    expect(fit("   ", 10, "pack")).toBe("pack");
    expect(fit("", 10, null)).toBe("…");
  });

  it("an owner's text that grows too long has its items shortened first, then the pack's text, then a cut", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ title: `${"y".repeat(118)} ${i}`, quantity: 1 }));
    const f = facts({ items, script: draft({ change_prompt: "عدّل إيه في {{order.items}}؟" }) });
    const out = text(chatContent("change_prompt", f));
    expect(out.length).toBeLessThanOrEqual(1000);
    expect(out).toMatch(/^عدّل إيه في .+؟$/);
    const huge = facts({ store: "s".repeat(990), script: draft({ cancelled: "{{store.name}} {{store.name}}" }) });
    expect(text(chatContent("cancelled", huge)).length).toBeLessThanOrEqual(1000);
  });

  it("a value that ends with a full stop swallows the next one", () => {
    expect(render("Total {{order.total}}.", facts())).toBe("Total 1,250 ج.م.");
    expect(render("Total {{order.total}}.", facts({ lang: "en" }))).toBe("Total EGP 1,250.");
    expect(render("{{order.number}}.", facts({ number: "A." }))).toBe("A.");
  });

  it("money in Arabic names the currency (no new riyal sign)", () => {
    expect(money({ amount: "1250.00", currency: "SAR" }, "ar")).toBe("1,250 ر.س");
    expect(money({ amount: "99.500", currency: "KWD" }, "ar")).toBe("99.500 د.ك");
    expect(money({ amount: "10.00", currency: "USD" }, "ar")).toBe("10 USD");
    expect(money({ amount: "1250.00", currency: "SAR" }, "en")).toBe("SAR 1,250");
  });
});

describe("the team's call script per pack", () => {
  it("formal and gulf keep the optional items and city lines in their own words", () => {
    const gulf = callScript(facts({ script: { version: 2, pack: "gulf", texts: { ar: {}, en: {} } }, items: [] }));
    expect(gulf.join(" ")).not.toContain(": .");
    expect(gulf.some((l) => l.startsWith("نتصل عشان نأكد طلبك رقم #1001."))).toBe(true);
    const formal = callScript(facts({ script: { version: 2, pack: "formal", texts: { ar: {}, en: {} } }, city: "جدة" }));
    expect(formal).toContain("التوصيل إلى جدة، أليس كذلك؟");
  });
});

describe("the tolerant reader", () => {
  it("a v1 blob keeps its texts and answers typed messages with its own 'change received'", () => {
    const v1 = { pack: "egyptian", texts: { ar: { change_received: "وصلنا يا {{customer.first_name}}" }, en: {} } };
    const { script, issues } = readScript(v1);
    // Nothing is copied into the stored script: a later edit of "change received" still answers typed messages.
    expect(script).toEqual({ version: 2, pack: "egyptian", texts: { ar: { change_received: "وصلنا يا {{customer.first_name}}" }, en: {} } });
    expect(issues).toEqual([]);
    expect(text(chatContent("noted", facts({ script: script! })))).toBe("وصلنا يا منى");
    const edited = { ...script!, texts: { ar: { change_received: "تمام يا {{customer.first_name}}" }, en: {} } };
    expect(text(chatContent("noted", facts({ script: edited })))).toBe("تمام يا منى");
    const own = { ...edited, texts: { ar: { ...edited.texts.ar, noted: "شكراً يا {{customer.first_name}}" }, en: {} } };
    expect(text(chatContent("noted", facts({ script: own })))).toBe("شكراً يا منى");
  });

  it("keeps a text that grew too long and reports it; drops a disallowed variable and reports it", () => {
    const raw = { version: 2, pack: "egyptian", texts: { ar: { btn_offer_yes: "x".repeat(30), offer_question: "{{order.number}}؟", madeup: "x" }, en: { confirmed: "{{customer.phone}}" } } };
    const { script, issues } = readScript(raw);
    expect(script?.texts.ar).toEqual({ btn_offer_yes: "x".repeat(30) });
    expect(script?.texts.en).toEqual({});
    expect(codes(issues).sort()).toEqual(["texts.ar.btn_offer_yes:too_long", "texts.ar.madeup:not_a_key", "texts.ar.offer_question:variable_not_here", "texts.en.confirmed:unknown_variable"]);
    expect(JSON.stringify(issues)).not.toContain("xxx"); // codes and paths, never the text
  });

  it("garbage gives the default, nothing stays nothing, a bad pack or reason list falls back", () => {
    expect(readScript("nope").script).toEqual({ pack: "egyptian", texts: { ar: {}, en: {} } });
    expect(readScript(undefined)).toEqual({ script: undefined, issues: [] });
    expect(readScript(null).script).toBeUndefined();
    const odd = readScript({ pack: "klingon", texts: { ar: {}, en: {} }, cancelReasons: [{ id: "BAD ID", code: "other", title: {} }] });
    expect(odd.script).toMatchObject({ pack: "egyptian" });
    expect(odd.script?.cancelReasons).toBeUndefined();
    expect(codes(odd.issues)).toEqual(["pack:invalid_pack", "cancelReasons:invalid_reasons"]);
    expect(readScript({ pack: "gulf", texts: { ar: {}, en: {} } })).toBe(readScript({ pack: "gulf", texts: { ar: {}, en: {} } })); // memoised
  });

  it("a broken script never resets the steps or calling hours", () => {
    const s = confirmationSettings({ confirmation: { steps: [{ channel: "whatsapp", waitMinutes: 30 }], callingHours: { start: "09:00", end: "21:00" }, script: { pack: "egyptian", texts: { ar: { confirmed: 42 }, en: {} } } } });
    expect(s.steps).toEqual([{ channel: "whatsapp", waitMinutes: 30 }]);
    expect(s.callingHours).toEqual({ start: "09:00", end: "21:00" });
    expect(s.script).toEqual({ version: 2, pack: "egyptian", texts: { ar: {}, en: {} } });
    expect(confirmationSettings({}).script).toBeUndefined();
    expect(confirmationSettings({}).steps).toEqual(DEFAULT_CONFIRMATION.steps);
  });

  it("issues with the store's real name: a rename can push a header over its limit", () => {
    const raw = { version: 2, pack: "egyptian", texts: { ar: { cancel_header: `${"x".repeat(50)} {{store.name}}` }, en: {} } };
    expect(scriptIssues(raw, { storeName: "Nile", storeLang: "ar" })).toEqual([]);
    expect(codes(scriptIssues(raw, { storeName: "A much longer store name", storeLang: "ar" }))).toEqual(["texts.ar.cancel_header:too_long"]);
  });
});

describe("cancel reasons sent and tapped", () => {
  it("the store's list with the keep row last; the code travels in the signed argument", () => {
    const script = draft({ cancel_header: "{{store.name}} · {{order.number}}", cancel_section: "الأسباب", footer: "{{store.name}}", keep_description: "هنكمّل عادي" }, {}, {
      cancelReasons: [{ id: "wrong_size", code: "changed_mind", title: { ar: "المقاس مش مظبوط" }, description: { ar: "هنبدّله لك" } }, { id: "other", code: "other", title: { ar: "حاجة تانية" } }],
    });
    const c = chatContent("cancel_reasons", facts({ script }));
    expect(c).toEqual({
      type: "list", body: "خسارة 😔 ممكن تقولنا ليه عايز تلغي؟", button: "اختار السبب",
      header: { type: "text", text: "متجر النيل · #1001" }, section: "الأسباب", footer: "متجر النيل",
      rows: [
        { action: "reason", arg: "0-wrong_size", title: "المقاس مش مظبوط", description: "هنبدّله لك" },
        { action: "reason", arg: "other", title: "حاجة تانية" },
        { action: "keep", title: "لا، كمّل الأوردر", description: "هنكمّل عادي" },
      ],
    });
    // English has no titles of its own: the pack's for each code.
    const en = chatContent("cancel_reasons", facts({ lang: "en", script }));
    expect(en.type === "list" && en.rows.map((r) => r.title)).toEqual(["Changed my mind", "Another reason", "No, keep my order"]);
  });

  it("reasonOf: the new argument, a bare code from before, anything else is other", () => {
    expect(reasonOf("4-wrong_size")).toEqual({ code: "other", id: "wrong_size" });
    expect(reasonOf("0-x")).toEqual({ code: "changed_mind", id: "x" });
    expect(reasonOf("found_cheaper")).toEqual({ code: "found_cheaper", id: "found_cheaper" });
    expect(reasonOf("9-x")).toEqual({ code: "other", id: null });
    expect(reasonOf("drop table")).toEqual({ code: "other", id: null });
    expect(reasonOf(undefined)).toEqual({ code: "other", id: null });
  });
});
