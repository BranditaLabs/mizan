import { describe, expect, it } from "vitest";
import { readScript, ScriptDraftSchema } from "../src/modules/confirmation/script.js";
import {
  AR_VARIANTS, chosenTemplate, effectiveTemplate, statusOf, submittable, TEMPLATE_ACTIONS, TEMPLATE_NAMES, TEMPLATE_SPECS, TEMPLATE_VARIANTS, templateActionOf,
} from "../src/modules/confirmation/templates.js";
import { judge } from "../src/modules/confirmation/whatsapp-connections.service.js";

/** E6-16d: the first message's templates, the owner's choice, what is sent, and how the number is judged. */
describe("the template catalogue", () => {
  it("keeps the two names already in stores' accounts and adds formal and Gulf", () => {
    expect(TEMPLATE_VARIANTS.map((v) => TEMPLATE_SPECS[v].name)).toEqual(["mizan_order_confirm_ar", "mizan_order_confirm_ar_formal", "mizan_order_confirm_ar_gulf", "mizan_order_confirm_en"]);
    expect(new Set(TEMPLATE_NAMES).size).toBe(4);
    expect(TEMPLATE_VARIANTS.map((v) => TEMPLATE_SPECS[v].lang)).toEqual(["ar", "ar", "ar", "en"]);
  });

  it.each(TEMPLATE_VARIANTS)("%s: Meta's rules — {{1}}..{{4}} once each, no variable at either end, three buttons of at most 20, an example per variable, a utility", (v) => {
    const s = TEMPLATE_SPECS[v];
    for (const n of [1, 2, 3, 4]) expect(s.body.split(`{{${n}}}`).length - 1, `{{${n}}}`).toBe(1);
    expect([...s.body.matchAll(/\{\{(\d+)\}\}/g)]).toHaveLength(4);
    expect(s.body).not.toMatch(/^\s*\{\{\d+\}\}/);
    expect(s.body).not.toMatch(/\{\{\d+\}\}\s*$/);
    expect(s.body.startsWith("👋 {{1}}")).toBe(true);
    expect(s.body.length).toBeLessThanOrEqual(1024);
    expect(s.buttons).toHaveLength(TEMPLATE_ACTIONS.length);
    for (const b of s.buttons) expect([...b].length, b).toBeLessThanOrEqual(20);
    expect(new Set(s.buttons).size).toBe(3);
    expect(s.example).toHaveLength(4);
    expect(s.category).toBe("UTILITY");
    expect(s.name).toMatch(/^[a-z0-9_]+$/);
  });

  it("a tap that came back with only its text maps to the right action whatever the variant", () => {
    for (const v of TEMPLATE_VARIANTS) TEMPLATE_SPECS[v].buttons.forEach((b, i) => expect(templateActionOf(b), `${v} ${b}`).toBe(TEMPLATE_ACTIONS[i]));
    expect(templateActionOf(" أبي أعدّل ")).toBe("change");
    expect(templateActionOf("أكّد")).toBeNull();
    expect(templateActionOf(undefined)).toBeNull();
    // No two variants share a title with different meanings.
    const meaning = new Map<string, string>();
    for (const v of TEMPLATE_VARIANTS) TEMPLATE_SPECS[v].buttons.forEach((b, i) => { expect(meaning.get(b) ?? TEMPLATE_ACTIONS[i]).toBe(TEMPLATE_ACTIONS[i]); meaning.set(b, TEMPLATE_ACTIONS[i]!); });
  });
});

describe("the owner's choice", () => {
  it("unset follows the pack; set wins; English is always en", () => {
    expect(chosenTemplate("ar", undefined)).toBe("ar_egyptian");
    expect(chosenTemplate("ar", { pack: "formal" })).toBe("ar_formal");
    expect(chosenTemplate("ar", { pack: "gulf" })).toBe("ar_gulf");
    expect(chosenTemplate("ar", { pack: "gulf", template: "ar_egyptian" })).toBe("ar_egyptian");
    expect(chosenTemplate("en", { pack: "gulf", template: "ar_formal" })).toBe("en");
  });

  it("is part of the script: the schema takes the three Arabic ones; the reader keeps it, and drops an unknown one with an issue", () => {
    expect(ScriptDraftSchema.safeParse({ pack: "egyptian", texts: { ar: {}, en: {} }, template: "ar_gulf" }).success).toBe(true);
    expect(ScriptDraftSchema.safeParse({ pack: "egyptian", texts: { ar: {}, en: {} }, template: "en" }).success).toBe(false);
    expect(readScript({ pack: "formal", texts: {}, template: "ar_gulf" }).script).toMatchObject({ pack: "formal", template: "ar_gulf" });
    const bad = readScript({ pack: "formal", texts: {}, template: "ar_shami" });
    expect(bad.script?.template).toBeUndefined();
    expect(bad.issues).toContainEqual({ path: ["template"], code: "invalid_template" });
  });
});

describe("what is sent", () => {
  const S = (o: Record<string, string>) => o;
  it("the chosen one when approved; else the first approved Arabic one, recorded as a fallback; else the chosen one", () => {
    const all = S({ mizan_order_confirm_ar: "APPROVED", mizan_order_confirm_ar_formal: "APPROVED", mizan_order_confirm_ar_gulf: "APPROVED", mizan_order_confirm_en: "APPROVED" });
    expect(effectiveTemplate("ar_gulf", "ar", all)).toEqual({ variant: "ar_gulf", fallback: false });
    expect(effectiveTemplate("ar_gulf", "ar", S({ mizan_order_confirm_ar_gulf: "PENDING", mizan_order_confirm_ar_formal: "APPROVED" }))).toEqual({ variant: "ar_formal", fallback: true });
    expect(effectiveTemplate("ar_formal", "ar", S({ mizan_order_confirm_ar: "APPROVED", mizan_order_confirm_ar_gulf: "APPROVED" }))).toEqual({ variant: "ar_egyptian", fallback: true });
    expect(effectiveTemplate("ar_gulf", "ar", S({ mizan_order_confirm_ar_gulf: "REJECTED" }))).toEqual({ variant: "ar_gulf", fallback: false });
    expect(effectiveTemplate("ar_gulf", "ar", null)).toEqual({ variant: "ar_gulf", fallback: false });
    expect(effectiveTemplate("en", "en", S({}))).toEqual({ variant: "en", fallback: false });
    expect(effectiveTemplate("ar_egyptian", "en", all)).toEqual({ variant: "en", fallback: false });
  });

  it("reads Meta's states: in appeal is in review, unknown words are refused, none is missing, nothing checked is unknown", () => {
    expect(statusOf({ mizan_order_confirm_ar: "IN_APPEAL" }, "ar_egyptian")).toBe("PENDING");
    expect(statusOf({ mizan_order_confirm_ar: "PAUSED" }, "ar_egyptian")).toBe("PAUSED");
    expect(statusOf({ mizan_order_confirm_ar: "DISABLED" }, "ar_egyptian")).toBe("DISABLED");
    expect(statusOf({ mizan_order_confirm_ar: "SOMETHING_NEW" }, "ar_egyptian")).toBe("REJECTED");
    expect(statusOf({}, "ar_egyptian")).toBe("MISSING");
    expect(statusOf(null, "ar_egyptian")).toBe("UNKNOWN");
    expect(["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED", "MISSING", "UNKNOWN"].filter((s) => submittable(s as never))).toEqual(["REJECTED", "MISSING"]);
  });
});

describe("judging the number", () => {
  const t = (name: string, status: string) => ({ name, language: name.endsWith("_en") ? "en" : "ar", status });
  it("active when any template for the store's language is approved; else the chosen one's state", () => {
    expect(judge([t("mizan_order_confirm_ar_formal", "APPROVED")], "ar", "ar_gulf")).toMatchObject({ status: "active", reason: null });
    expect(judge([t("mizan_order_confirm_ar_gulf", "PENDING"), t("mizan_order_confirm_en", "APPROVED")], "ar", "ar_gulf")).toMatchObject({ status: "needs_attention", reason: "template_pending" });
    expect(judge([t("mizan_order_confirm_ar_gulf", "REJECTED")], "ar", "ar_gulf")).toMatchObject({ status: "needs_attention", reason: "template_rejected" });
    expect(judge([t("mizan_order_confirm_ar", "PAUSED")], "ar", "ar_gulf")).toMatchObject({ status: "needs_attention", reason: "template_missing" });
    expect(judge([t("mizan_order_confirm_ar", "APPROVED")], "en", "en")).toMatchObject({ status: "needs_attention", reason: "template_missing" });
    expect(judge([t("mizan_order_confirm_en", "APPROVED")], "en", "en")).toMatchObject({ status: "active" });
  });

  it("keeps only the four names, with Meta's states", () => {
    expect(judge([t("mizan_order_confirm_ar", "APPROVED"), t("old_template", "PAUSED"), t("mizan_order_confirm_ar_gulf", "PENDING")], "ar", "ar_egyptian").templates)
      .toEqual({ mizan_order_confirm_ar: "APPROVED", mizan_order_confirm_ar_gulf: "PENDING" });
    expect(AR_VARIANTS).toEqual(["ar_egyptian", "ar_formal", "ar_gulf"]);
  });
});
