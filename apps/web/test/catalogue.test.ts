import { COST_FLAGS, FEE_METHOD_SLUGS, PAYMENT_METHOD_SLUGS, PROVIDER_CATALOG, PROVIDER_SLUGS } from "@mizan/shared";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

type Tree = { [k: string]: string | Tree };
const at = (m: Tree, path: string) => path.split(".").reduce<string | Tree | undefined>((n, k) => (n && typeof n === "object" ? n[k] : undefined), m);

describe("screens follow the shared catalogue (X9)", () => {
  it("every provider has a name for the bell and Settings → Integrations, in both languages", () => {
    for (const m of [ar, en] as Tree[]) for (const slug of PROVIDER_SLUGS) {
      expect(typeof at(m, `notifications.providers.${slug}`), slug).toBe("string");
      expect(typeof at(m, `integrationsSettings.providers.${slug}`), slug).toBe("string");
    }
  });

  it("every payment method has a name on the order and the payment mix", () => {
    for (const m of [ar, en] as Tree[]) for (const slug of PAYMENT_METHOD_SLUGS) expect(typeof at(m, `orders.detail.method.${slug}`), slug).toBe("string");
  });

  it("Arabic catalogue names are Arabic (no Latin words on Arabic pages)", () => {
    for (const p of PROVIDER_CATALOG) expect(p.nameAr, p.slug).toMatch(/^[^A-Za-z]+$/);
  });

  it("every missing-input flag the API counts has a line on the order's profit card (FX-2)", () => {
    for (const m of [ar, en] as Tree[]) for (const f of COST_FLAGS) expect(typeof at(m, `orders.profit.missing.${f}`), f).toBe("string");
  });

  it("fee methods are payment methods", () => {
    for (const m of FEE_METHOD_SLUGS) expect(PAYMENT_METHOD_SLUGS).toContain(m);
  });
});
