import { expect, test, type Page } from "@playwright/test";
import { mizan, ownerWithStore, signInOwner } from "./stack";

/**
 * The responsive contract (docs/16 §1.4 and §11.1 FX-1), on every store route, at the widths and
 * input modes the plan names:
 *  - no page scrolls sideways (`scrollWidth ≤ innerWidth`);
 *  - no visible control smaller than 24×24 with a mouse, 44×44 on a coarse pointer (inline links
 *    inside a sentence are exempt, as in WCAG 2.5.8);
 *  - on /ar, no Latin word (4+ letters) outside <bdi> (ids, phones, brand names and typed data are
 *    isolated there);
 *  - no Arabic-Indic digits anywhere (digits are Western in both languages unless the store chose
 *    Eastern ones, docs/08 §3).
 * Target sizes are measured on every run and attached as `targets.txt`, but fail the run only with
 * RESPONSIVE_TARGETS=strict: the screen lanes (docs/16 B2, B3, B6, B8; DataTable v2) bring the
 * shell, tabs, inputs and table controls to 24/44px, and FX-1 is ticked once this passes strict.
 * Sideways scroll, Latin outside <bdi> and Arabic-Indic digits always fail.
 * Every PR that adds a route adds it to ROUTES (docs/16 §11.0). The store has data (an order whose
 * product has no cost, a ticket, a draft purchase order), so the provisional states, the tables and
 * the detail screens are measured too, not only empty states.
 */
const ROUTES = [
  "/", "/onboarding", "/orders", "/orders/new", "/confirmation", "/shipping", "/payments", "/tickets", "/products", "/products/new",
  "/stock", "/stock/picklists", "/purchasing", "/purchasing/new", "/purchasing/reorder", "/purchasing/suppliers",
  "/profit", "/profit/ads", "/profit/spend", "/reports", "/automations",
  "/settings", "/settings/store", "/settings/orders", "/settings/payments", "/settings/refunds", "/settings/usage", "/settings/privacy",
  "/settings/purchasing", "/settings/inventory", "/settings/offers", "/settings/ads", "/settings/after-confirmation", "/settings/store-sync",
  "/settings/confirmation", "/settings/confirmation/studio", "/settings/costs", "/settings/integrations", "/settings/team", "/settings/audit",
] as const;
/** Detail routes, filled in from the seeded data. */
const DETAIL = (d: Seeded) => [`/orders/${d.order}`, `/tickets/${d.ticket}`, `/products/${d.product}`, `/purchasing/${d.po}`, `/purchasing/${d.po}/edit`];

interface Seeded { order: string; ticket: string; product: string; po: string }
/** One product with no cost yet, an order of it (so profit is provisional), a ticket on it, a draft purchase order. */
async function seed(owner: { token: string; storeId: string }): Promise<Seeded> {
  const call = <T>(method: string, path: string, body?: unknown) => mizan<T>(owner.token, method, path, body, owner.storeId);
  const product = (await call<{ id: string }>("POST", "/products", { title: "عباية سادة", status: "active", variants: [{ sku: `RESP-${Date.now()}`, price: "1000" }] })).id;
  const variant = (await call<{ variants: Array<{ id: string }> }>("GET", `/products/${product}`)).variants[0]!.id;
  const order = (await call<{ id: string }>("POST", "/orders", {
    source: "phone", customer: { name: "منى عادل", phone: "01001234821" }, address: { line1: "12 شارع عباس العقاد", city: "مدينة نصر" },
    lines: [{ variantId: variant, quantity: 1 }], shipping: "0", payment: { mode: "cod" },
  })).id;
  const ticket = (await call<{ id: string }>("POST", "/tickets", { type: "complaint", orderId: order, description: "العميلة بتسأل على المقاس" })).id;
  const supplier = (await call<{ id: string }>("POST", "/suppliers", { name: `مورد ${Date.now()}`, currency: "EGP" })).id;
  const po = (await call<{ id: string }>("POST", "/purchase-orders", { supplierId: supplier, lines: [{ variantId: variant, quantity: 5, unitCost: "400" }] })).id;
  return { order, ticket, product, po };
}

/** Target sizes fail the run only when asked (see the header); until then they are reported. */
const STRICT_TARGETS = process.env.RESPONSIVE_TARGETS === "strict";

const CASES = [
  { name: "phone 390×844", viewport: { width: 390, height: 844 }, coarse: true },
  { name: "phone landscape 844×390", viewport: { width: 844, height: 390 }, coarse: true },
  { name: "tablet 820×1180", viewport: { width: 820, height: 1180 }, coarse: true },
  { name: "desktop 1440×900", viewport: { width: 1440, height: 900 }, coarse: false },
  { name: "touch laptop 1280×800 (coarse pointer)", viewport: { width: 1280, height: 800 }, coarse: true },
] as const;

interface Breach { kind: string; detail: string }

/** Everything the contract checks, measured inside the page. */
async function audit(page: Page, { minTarget, arabic }: { minTarget: number; arabic: boolean }): Promise<Breach[]> {
  return page.evaluate(({ minTarget, arabic }) => {
    const out: Array<{ kind: string; detail: string }> = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth) out.push({ kind: "sideways-scroll", detail: `${doc.scrollWidth} > ${window.innerWidth}` });

    const visible = (el: Element) => {
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1; // sr-only elements are 1×1
    };
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}"`;
    const CONTROLS = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=checkbox], [role=switch], [role=menuitem]";
    for (const el of document.querySelectorAll(CONTROLS)) {
      if (!visible(el) || el.closest("[aria-hidden=true], [inert]")) continue;
      // Inline links inside a sentence are exempt (WCAG 2.5.8 "inline").
      if (el.tagName === "A" && getComputedStyle(el).display === "inline" && el.parentElement?.closest("p, li, dd, td, label")) continue;
      // A visually hidden native input under its custom box is measured by its label.
      if (el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type) && el.labels?.length) {
        const label = el.labels[0]!.getBoundingClientRect();
        if (label.width >= minTarget && label.height >= minTarget) continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width < minTarget || r.height < minTarget) out.push({ kind: `target<${minTarget}`, detail: `${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}` });
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? "";
      const parent = n.parentElement;
      if (!parent || !text.trim() || parent.closest("script, style, noscript, svg, template") || !visible(parent)) continue;
      if (/[٠-٩۰-۹]/.test(text)) out.push({ kind: "arabic-indic-digits", detail: text.trim().slice(0, 60) });
      if (arabic && /[A-Za-z]{4,}/.test(text) && !parent.closest("bdi, code, kbd, [translate=no]")) out.push({ kind: "latin-outside-bdi", detail: text.trim().slice(0, 60) });
    }
    return out;
  }, { minTarget, arabic });
}

for (const c of CASES) {
  test.describe(`responsive contract: ${c.name}`, () => {
    test.use({ viewport: c.viewport, hasTouch: c.coarse });

    for (const locale of ["ar", "en"] as const) {
      test(`every store route in ${locale}`, async ({ page }, info) => {
        test.setTimeout(480_000);
        const owner = await ownerWithStore(locale === "ar" ? "متجر المقاسات" : "متجر Sizes");
        const data = await seed(owner);
        await page.goto(`/${locale}/sign-in`);
        await signInOwner(page, owner, locale);
        await expect(page).toHaveURL(new RegExp(`/${locale}$`));
        if (c.coarse) {
          // Touch emulation must turn the coarse-pointer rules on, or the 44px check means nothing.
          expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "(pointer: coarse) under touch emulation").toBe(true);
        }

        const breaches: string[] = [];
        const targets: string[] = [];
        for (const route of [...ROUTES, ...DETAIL(data)]) {
          await page.goto(`/${locale}${route === "/" ? "" : route}`);
          await page.waitForLoadState("networkidle");
          await expect(page.getByRole("main")).toBeVisible();
          for (const b of await audit(page, { minTarget: c.coarse ? 44 : 24, arabic: locale === "ar" })) {
            (b.kind.startsWith("target<") && !STRICT_TARGETS ? targets : breaches).push(`${route} ${b.kind}: ${b.detail}`);
          }
          if ((route === "/" || route === "/onboarding") && c.viewport.width === 390) {
            await page.screenshot({ path: `test-results/responsive-${locale}${route === "/" ? "-home" : "-onboarding"}-390.png`, fullPage: true });
          }
        }
        if (targets.length) {
          await info.attach("targets.txt", { body: targets.join("\n"), contentType: "text/plain" });
          info.annotations.push({ type: "targets", description: `${targets.length} controls under ${c.coarse ? 44 : 24}px (RESPONSIVE_TARGETS=strict fails on them)` });
        }
        if (breaches.length) await info.attach("breaches.txt", { body: breaches.join("\n"), contentType: "text/plain" });
        expect(breaches, breaches.slice(0, 40).join("\n")).toEqual([]);
      });
    }
  });
}
