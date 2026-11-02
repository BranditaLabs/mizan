import { describe, expect, it } from "vitest";
import { validate } from "../src/modules/automations/automations.service.js";
import { evaluate } from "../src/modules/automations/conditions.js";
import { RECIPES } from "../src/modules/automations/recipes.js";
import { fill } from "../src/modules/automations/runtime.js";

describe("built-in recipes (E11-2)", () => {
  it.each(RECIPES.map((r) => [r.key, r] as const))("%s is valid against the catalogue in Arabic and English", (_key, r) => {
    for (const lang of ["ar", "en"] as const) {
      expect(() => validate({ name: r.name[lang], trigger: r.trigger, conditions: r.conditions, steps: r.steps(lang), enabled: false })).not.toThrow();
      // Messages only use fields the trigger's context has.
      for (const s of r.steps(lang)) if (s.action === "notify.team") expect(String(s.params.message)).not.toMatch(/\{\{\s*(customer|address|phone)/);
    }
    expect(r.name.ar).toMatch(/[؀-ۿ]/);
  });

  it("keys are unique; the big COD recipe matches a big COD order and fills its message", () => {
    expect(new Set(RECIPES.map((r) => r.key)).size).toBe(RECIPES.length);
    const r = RECIPES.find((x) => x.key === "big_cod_order")!;
    const ctx = { event: { type: "order.created", data: {} }, order: { number: "#1042", paymentMode: "cod", total: 1650, currency: "EGP" } };
    expect(evaluate(r.conditions, ctx)).toBe(true);
    expect(evaluate(r.conditions, { ...ctx, order: { ...ctx.order, paymentMode: "card" } })).toBe(false);
    expect(fill(String(r.steps("en")[1]!.params.message), ctx)).toBe("Big COD order #1042: 1650 EGP");
  });
});
