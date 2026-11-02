import { describe, expect, it } from "vitest";
import { callScript, chatContent, type MessageFacts } from "../src/modules/confirmation/messages.js";
import { render, ScriptSchema, scriptText, unknownVariables, type Script } from "../src/modules/confirmation/script.js";

/** E6-5: the store's own wording, variables from the order, Egyptian or formal Arabic packs. */
const egp = (amount: string) => ({ amount, currency: "EGP" });
const facts = (over: Partial<MessageFacts> = {}): MessageFacts => ({
  lang: "ar", store: "متجر النيل", firstName: "منى", number: "#1001", total: egp("1250.00"), cod: egp("1250.00"), link: "",
  items: [{ title: "عباية سادة", quantity: 2 }], city: "مدينة نصر", ...over,
});
const text = (c: ReturnType<typeof chatContent>) => (c.type === "text" ? c.text : c.body);

describe("confirmation script (E6-5)", () => {
  it("fills variables from the order, never more than the messages show", () => {
    expect(render("أهلاً {{customer.first_name}}، أوردرك {{ order.number }} بـ {{order.cod}}: {{order.items}} لـ {{order.city}} من {{store.name}}", facts()))
      .toBe("أهلاً منى، أوردرك #1001 بـ 1,250 ج.م. عند الاستلام: عباية سادة × 2 لـ مدينة نصر من متجر النيل");
    expect(render("Paid: {{order.cod}}, total {{order.total}}", facts({ lang: "en", cod: egp("0.00") }))).toBe("Paid: EGP 1,250, total EGP 1,250");
    expect(render("{{customer.first_name}}", facts({ firstName: null }))).toBe("حضرتك");
  });

  it("refuses variables it doesn't know (an address or phone is never one)", () => {
    expect(unknownVariables("{{customer.phone}} {{order.number}} {{customer.address}}")).toEqual(["customer.phone", "customer.address"]);
    const bad = ScriptSchema.safeParse({ pack: "egyptian", texts: { ar: { confirmed: "تم {{customer.phone}}" }, en: {} } });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain("{{customer.phone}}");
  });

  it("the owner's wording answers each button; what they left empty keeps the pack's", () => {
    const script: Script = { pack: "egyptian", texts: { ar: { confirmed: "تمام يا {{customer.first_name}} ✅ {{order.number}} اتأكّد", cancel_prompt: "ليه عايز تلغي؟" }, en: {} } };
    const f = facts({ script });
    expect(text(chatContent("confirmed", f))).toBe("تمام يا منى ✅ #1001 اتأكّد");
    expect(text(chatContent("cancel_reasons", f))).toBe("ليه عايز تلغي؟");
    expect(text(chatContent("change_prompt", f))).toContain("اكتب لنا التعديل"); // the built-in Egyptian
    expect(text(chatContent("confirmed", facts({ lang: "en", script })))).toContain("Done ✅"); // English untouched
  });

  it("the formal pack speaks formal Arabic; the owner's text still wins", () => {
    const formal: Script = { pack: "formal", texts: { ar: {}, en: {} } };
    expect(text(chatContent("confirmed", facts({ script: formal })))).toBe("تم ✅ تأكيد طلبك #1001 وسيتم شحنه قريباً. شكراً لاختيارك متجر النيل.");
    expect(scriptText({ ...formal, texts: { ar: { cancelled: "خلاص" }, en: {} } }, "ar", "cancelled")).toBe("خلاص");
    expect(scriptText(formal, "en", "cancelled")).toBeNull();
  });

  it("the call script is the owner's lines, with the offer still at the end", () => {
    const script: Script = { pack: "egyptian", texts: { ar: { call: "أهلاً {{customer.first_name}}\n\nبنأكّد {{order.number}} بـ {{order.cod}}" }, en: {} } };
    const offer = { id: "o1", title: "طرحة", qty: 1, price: egp("135.00"), was: egp("150.00"), message: null, newTotal: egp("1385.00") };
    expect(callScript(facts({ script }))).toEqual(["أهلاً منى", "بنأكّد #1001 بـ 1,250 ج.م. عند الاستلام"]);
    expect(callScript(facts({ script, offer })).at(-1)).toContain("طرحة بـ 135 ج.م. بدل 150 ج.م.");
  });
});
