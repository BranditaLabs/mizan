import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { partnerBySlug, planPartnerLogo } from "../logos/partners/index.ts";

/** DS-3 (docs/16 §5.9): partner logos, their manifest, and what PartnerLogo draws. */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "../..");
const dir = join(root, "logos/partners");
const M = JSON.parse(readFileSync(join(dir, "partners.json"), "utf8"));
const P = M.partners;
const svgs = readdirSync(dir).filter((f) => f.endsWith(".svg"));
const VARIANT_FILE = { color: (s) => `${s}.svg`, black: (s) => `${s}-black.svg`, white: (s) => `${s}-white.svg`, "on-dark": (s) => `${s}-on-dark.svg` };

/**
 * Every provider Mizan names today. CN-2 replaces this with the packages/shared catalogue constant
 * (the one /v1/integrations/catalog serves); until then: the docs/16 §5.9 lists, the engine's
 * connectors, provider ids in code, the couriers in Settings → Costs and the ad platforms.
 */
const CATALOGUE = [
  "shopify", "woocommerce", "wordpress", "salla", "zid", "youcan", "easyorders", "lightfunnels",
  "amazon", "noon", "jumia",
  "bosta", "jt", "mylerz", "aramex", "smsa", "spl", "aymakan", "r2s", "dhl", "fedex", "ups",
  "paymob", "kashier", "fawry", "geidea", "moyasar", "tap", "hyperpay", "valu", "tabby", "tamara", "checkoutcom",
  "instapay", "vodafonecash", "stripe", "paypal", "visa", "mastercard", "applepay", "googlepay",
  "whatsapp", "whatsapp_cloud", "meta_whatsapp", "meta", "facebook", "instagram", "tiktok", "snapchat", "google", "googleads", "microsoft", "x",
  "zatca",
];
const engineConnectors = () => readdirSync(join(repo, "packages/engine/src/connectors"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && !["ai", "messaging"].includes(d.name)).map((d) => d.name);

describe("partner manifest", () => {
  it("every catalogue provider resolves to a logo or a monogram", () => {
    for (const slug of [...CATALOGUE, ...engineConnectors()]) {
      const e = partnerBySlug(slug);
      expect(e, slug).toBeDefined();
      expect(e.monogram || e.allowedVariants.length > 0, slug).toBe(true);
      expect(["mark", "monogram", "text"]).toContain(planPartnerLogo(slug, 96).kind);
    }
  });

  it("slugs and aliases are unique, lower-case ids", () => {
    const ids = P.flatMap((e) => [e.slug, ...(e.aliases ?? [])]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]+$/);
  });

  it("every entry records its source, both names and its usage limits", () => {
    for (const e of P) {
      expect(e.source, e.slug).toMatch(/^(simple-icons@\d+\.\d+\.\d+|press-kit|monogram)$/);
      if (e.simpleIcons) expect(e.source, e.slug).toBe(`simple-icons@${M.simpleIcons}`);
      expect(e.nameEn.trim() && e.nameAr.trim(), e.slug).toBeTruthy();
      expect(/[؀-ۿ]/.test(e.nameAr), e.slug).toBe(true);
      expect(e.nominativeOnly, e.slug).toBe(true);
      expect(e.clearSpace, e.slug).toBeGreaterThan(0);
      expect(e.minPx, e.slug).toBeGreaterThanOrEqual(16);
    }
  });

  it("an entry that ships a mark has guideUrl, allowedVariants and minPx", () => {
    for (const e of P.filter((p) => !p.monogram)) {
      expect(e.guideUrl, e.slug).toMatch(/^https:\/\//);
      expect(e.allowedVariants.length, e.slug).toBeGreaterThan(0);
      expect(e.minPx, e.slug).toBeGreaterThan(0);
      expect(e.license, e.slug).toBeTruthy();
      expect(e.retrievedAt, e.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const v of e.allowedVariants) expect(existsSync(join(dir, VARIANT_FILE[v](e.slug))), `${e.slug} ${v}`).toBe(true);
    }
  });

  it("no file without an allowed variant (a mono file exists only if the guide allows it)", () => {
    const allowed = new Set(P.filter((e) => !e.monogram).flatMap((e) => e.allowedVariants.map((v) => VARIANT_FILE[v](e.slug))));
    expect(svgs.filter((f) => !allowed.has(f))).toEqual([]);
  });

  it("brands whose guide asks for their own artwork never ship a simple-icons path", () => {
    for (const slug of ["whatsapp", "applepay", "meta", "facebook", "instagram"]) expect(partnerBySlug(slug).monogram, slug).toBe(true);
    expect(partnerBySlug("stripe").allowedVariants).not.toContain("black"); // Stripe: slate/blurple or white only
  });
});

describe("partner SVG files", () => {
  it.each(svgs)("%s is scrubbed: one svg, no script, no external reference, no foreignObject, no handlers", (f) => {
    const s = readFileSync(join(dir, f), "utf8");
    expect(s.trim().startsWith("<svg")).toBe(true);
    expect(s).not.toMatch(/<script|<foreignObject|<image|<use|\son\w+=|javascript:|href=|url\(|<style/i);
    expect(s).toMatch(/viewBox="0 0 24 24"/);
    expect(s).toMatch(/<title>[^<]+<\/title>/);
  });
  it("mono files are exactly black or white; colour files use one brand colour", () => {
    for (const f of svgs) {
      const fills = [...readFileSync(join(dir, f), "utf8").matchAll(/fill="([^"]+)"/g)].map((m) => m[1]);
      if (f.endsWith("-black.svg")) expect(fills, f).toEqual(["#000000"]);
      else if (f.endsWith("-white.svg")) expect(fills, f).toEqual(["#FFFFFF"]);
      else expect(fills.length, f).toBe(1);
    }
  });
  it("logos/partners/data.ts is up to date", () => {
    const read = () => readFileSync(join(dir, "data.ts"), "utf8").replace(/\r\n/g, "\n");
    const before = read();
    execFileSync("node", [join(root, "scripts/build-partners.mjs")]);
    expect(read()).toEqual(before);
  });
});

describe("planPartnerLogo", () => {
  it("colour sits on a light tile in both themes; mono uses the brand's black and white files", () => {
    const c = planPartnerLogo("woocommerce", 40);
    expect(c.kind).toBe("mark");
    expect([c.light.variant, c.light.tile, c.dark.variant, c.dark.tile]).toEqual(["color", true, "color", true]);
    const m = planPartnerLogo("woocommerce", 40, "mono");
    expect([m.light.variant, m.light.tile, m.dark.variant, m.dark.tile]).toEqual(["black", false, "white", false]);
  });
  it("mono falls back to colour on a tile where the guide allows no black (Stripe)", () => {
    const m = planPartnerLogo("stripe", 40, "mono");
    expect([m.light.variant, m.light.tile, m.dark.variant]).toEqual(["color", true, "white"]);
  });
  it("keeps the guide's minimum size: below it, a monogram", () => {
    expect(planPartnerLogo("shopify", 40).kind).toBe("monogram"); // Shopify: not below 80px
    const big = planPartnerLogo("shopify", 160);
    expect(big.kind).toBe("mark");
    expect(big.markPx).toBeGreaterThanOrEqual(80);
    expect(big.markPx + 2 * big.padPx).toBe(160);
    expect(big.padPx).toBe(Math.round(160 * 0.5 / 2)); // ½ S of clear space on each side
  });
  it("monograms carry the brand's initial and its name in the reader's language", () => {
    expect(planPartnerLogo("bosta", 32, "color", "ar")).toMatchObject({ kind: "monogram", text: "B", name: "بوسطة" });
    expect(planPartnerLogo("jt", 32)).toMatchObject({ kind: "monogram", text: "J&T", name: "J&T Express" });
    expect(planPartnerLogo("whatsapp_cloud", 32)).toMatchObject({ kind: "monogram", name: "WhatsApp" });
    expect(planPartnerLogo("unheard-of", 32)).toMatchObject({ kind: "monogram", text: "U", name: "unheard-of" });
    expect(planPartnerLogo("zatca", 32, "color", "ar")).toMatchObject({ kind: "text" });
  });
});
