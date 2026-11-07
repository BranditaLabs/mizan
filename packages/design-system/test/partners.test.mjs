import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RASTERS, partnerBySlug, partnerMarkMinSize, partnerRasterSrc, planPartnerLogo } from "../logos/partners/index.ts";

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
  "bosta", "jt", "mylerz", "aramex", "smsa", "spl", "aymakan", "r2s", "dhl", "fedex", "ups", "manual", "other",
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
      expect(["mark", "raster", "monogram", "text"]).toContain(planPartnerLogo(slug, 96).kind);
    }
  });

  it("slugs and aliases are unique, lower-case ids", () => {
    const ids = P.flatMap((e) => [e.slug, ...(e.aliases ?? [])]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]+$/);
  });

  it("every entry records its source, both names and its usage limits", () => {
    for (const e of P) {
      expect(e.source, e.slug).toMatch(/^(simple-icons@\d+\.\d+\.\d+|press-kit|owner-supplied \d{4}-\d{2}-\d{2}|monogram)$/);
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
      // An owner-supplied logo (DS-3b) may come before its guide is found; its note carries the [CONFIRM].
      if (e.guideUrl !== null || !e.raster) expect(e.guideUrl, e.slug).toMatch(/^https:\/\//);
      expect(e.allowedVariants.length, e.slug).toBeGreaterThan(0);
      expect(e.minPx, e.slug).toBeGreaterThan(0);
      expect(e.license, e.slug).toBeTruthy();
      expect(e.retrievedAt, e.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // The colour face is the SVG, or the owner's bitmap where there is one.
      for (const v of e.allowedVariants) expect(existsSync(join(dir, VARIANT_FILE[v](e.slug))) || (v === "color" && !!RASTERS[e.slug]), `${e.slug} ${v}`).toBe(true);
    }
  });

  it("no file without an allowed variant (a mono file exists only if the guide allows it)", () => {
    const allowed = new Set(P.filter((e) => !e.monogram).flatMap((e) => e.allowedVariants.map((v) => VARIANT_FILE[v](e.slug))));
    expect(svgs.filter((f) => !allowed.has(f))).toEqual([]);
  });

  it("brands whose guide asks for their own artwork never ship a simple-icons path", () => {
    // Stripe's guide covers its wordmark (and a checkout badge), not simple-icons' S glyph.
    for (const slug of ["applepay", "facebook", "instagram", "stripe"]) {
      expect(partnerBySlug(slug).monogram, slug).toBe(true);
      for (const s of [16, 48, 320]) expect(planPartnerLogo(slug, s, "mono").kind, slug).toBe("monogram");
    }
    // WhatsApp and Meta: the owner's own files (DS-3b), never a simple-icons path.
    for (const slug of ["whatsapp", "meta"]) {
      expect(P.find((e) => e.slug === slug).simpleIcons, slug).toBeUndefined();
      expect(svgs.filter((f) => f.startsWith(slug)), slug).toEqual([]);
      for (const s of [24, 48, 320]) for (const v of ["color", "mono"]) expect(planPartnerLogo(slug, s, v).kind, `${slug} ${s} ${v}`).toBe("raster");
    }
    expect(partnerBySlug("stripe").guideCheckedAt).toBeNull();
    expect(svgs.filter((f) => f.startsWith("stripe"))).toEqual([]);
  });

  it("a guide that asks for written permission keeps the brand a monogram until it is granted or the owner decides", () => {
    for (const e of P.filter((p) => !p.monogram)) expect(e.permission, e.slug).toMatch(/^(not-required|required|(granted|owner):\d{4}-\d{2}-\d{2})$/);
    // "use must be authorized in writing": the owner supplied the official logo and enabled it (DS-3b).
    expect(partnerBySlug("shopify").permission).toBe("owner:2026-11-07");
    for (const e of P.filter((p) => p.permission !== "not-required" && !/^(granted|owner):/.test(p.permission ?? ""))) {
      for (const s of [16, 48, 96, 160, 320, 640]) for (const v of ["color", "mono"]) expect(planPartnerLogo(e.slug, s, v).kind, `${e.slug} ${s} ${v}`).not.toBe("mark");
    }
  });

  it("no mark is drawn before someone has read the brand's guide (guideCheckedAt)", () => {
    for (const e of P) {
      const drawn = [16, 24, 32, 48, 96, 160, 320].some((s) => ["color", "mono"].some((v) => planPartnerLogo(e.slug, s, v).kind === "mark"));
      if (drawn) expect(e.guideCheckedAt, e.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Files are in, guides unread: monograms until someone confirms them.
    for (const slug of ["wordpress", "x"]) {
      expect(partnerBySlug(slug).guideCheckedAt, slug).toBeNull();
      expect(planPartnerLogo(slug, 320).kind, slug).toBe("monogram");
      expect(planPartnerLogo(slug, 320, "mono").kind, slug).toBe("monogram");
    }
  });

  it("a colour simple-icons file is the brand's whole mark, so Shopify's two-green bag is the owner's bitmap", () => {
    // simple-icons draws Shopify's bag as one green path; the real full-colour mark is two greens with a white S.
    expect(existsSync(join(dir, "shopify.svg"))).toBe(false);
    expect(partnerBySlug("shopify").allowedVariants).toEqual(["color", "black", "white"]);
    expect(RASTERS.shopify.mark.light.file).toBe("shopify-mark");
    expect(planPartnerLogo("shopify", 40)).toMatchObject({ kind: "raster", shape: "mark" });
  });

  it("monograms are distinct within a kind, so a picker or a table can tell them apart", () => {
    for (const kind of new Set(P.map((e) => e.kind))) {
      const texts = P.filter((e) => e.kind === kind && !e.textOnly).map((e) => planPartnerLogo(e.slug, 16).text);
      expect(texts.every(Boolean), kind).toBe(true);
      const dupes = texts.filter((t, i) => texts.indexOf(t) !== i);
      expect(dupes, kind).toEqual([]);
    }
  });
});

describe("owner-supplied partner logos (DS-3b)", () => {
  const rasterDir = join(dir, "raster");
  const files = readdirSync(rasterDir);
  const ENABLED = ["shopify", "woocommerce", "bosta", "whatsapp", "meta"];

  it("each enabled partner has its faces, its owner source and a licence note", () => {
    for (const slug of ENABLED) {
      const e = P.find((p) => p.slug === slug);
      expect(e.monogram, slug).toBe(false);
      expect(e.raster?.source, slug).toBe("owner-supplied 2026-11-07");
      expect(e.raster.license, slug).toBe("owner-supplied official logo; usage per each brand's guidelines for integration listings");
      expect(e.raster.retrievedAt, slug).toBe("2026-11-07");
      expect(e.permission, slug).toMatch(/^(not-required|owner:2026-11-07)$/);
      expect(partnerBySlug(slug).rasterSource, slug).toBe("owner-supplied 2026-11-07");
      expect(RASTERS[slug]?.mark.light, slug).toBeDefined();
      for (const k of [1, 2, 3]) expect(files, `${slug} @${k}x`).toContain(`${slug}-mark@${k}x.png`);
    }
    // Lockups where the logo has a wordmark; a dark face where it has black parts (white on dark).
    expect(Object.keys(RASTERS).filter((s) => RASTERS[s].lockup).sort()).toEqual(["bosta", "meta", "shopify", "woocommerce"]);
    expect(Object.keys(RASTERS).filter((s) => RASTERS[s].lockup?.dark).sort()).toEqual(["meta", "shopify"]);
    expect(Object.keys(RASTERS).filter((s) => RASTERS[s].mark.dark)).toEqual([]); // marks sit on their light tile
    expect(Object.keys(RASTERS).sort()).toEqual([...ENABLED].sort());
  });

  it("files are 1x/2x/3x PNGs of the declared sizes, small", () => {
    for (const r of Object.values(RASTERS)) {
      for (const img of [r.mark.light, r.mark.dark, r.lockup?.light, r.lockup?.dark].filter(Boolean)) {
        img.widths.forEach((w, i) => {
          const b = readFileSync(join(rasterDir, `${img.file}@${i + 1}x.png`));
          expect(b.subarray(1, 4).toString(), img.file).toBe("PNG");
          expect(b.readUInt32BE(16), img.file).toBe(w);
          expect(b.readUInt32BE(20), img.file).toBe(img.h * (i + 1));
          expect(Math.abs(w - img.w * (i + 1)), img.file).toBeLessThanOrEqual(2);
          expect(b.length, img.file).toBeLessThan(12 * 1024);
        });
      }
    }
    expect(files.every((f) => /^[a-z]+-(mark|lockup)(-dark)?@[123]x\.png$/.test(f)), files.join()).toBe(true);
  });

  it("the apps serve the same files from /partners", () => {
    for (const app of ["apps/web/public/partners", "apps/admin/public/partners"]) {
      expect(readdirSync(join(repo, app)).sort(), app).toEqual([...files].sort());
      for (const f of files) expect(readFileSync(join(repo, app, f)).equals(readFileSync(join(rasterDir, f))), `${app}/${f}`).toBe(true);
    }
    expect(partnerRasterSrc(RASTERS.bosta.mark.light)).toEqual({
      src: "/partners/bosta-mark@1x.png",
      srcSet: "/partners/bosta-mark@1x.png 32w, /partners/bosta-mark@2x.png 64w, /partners/bosta-mark@3x.png 96w",
    });
  });

  it("lockups keep their minimum width (Shopify's 80px), else the mark", () => {
    expect(planPartnerLogo("shopify", 24, "color", "en", undefined, "lockup")).toMatchObject({ kind: "raster", shape: "lockup", height: 24 });
    // 22px tall is 76px wide, under 80: the bag instead, which at 22px (with its clear space) is under 16px too.
    expect(planPartnerLogo("shopify", 22, "color", "en", undefined, "lockup").kind).toBe("monogram");
    expect(planPartnerLogo("bosta", 12, "color", "en", undefined, "lockup")).toMatchObject({ kind: "raster", shape: "lockup", width: 40 });
    const meta = planPartnerLogo("meta", 24, "color", "ar", undefined, "lockup");
    expect(meta).toMatchObject({ kind: "raster", shape: "lockup", name: "ميتا" });
    expect([meta.light.image.file, meta.dark.image.file, meta.light.tile]).toEqual(["meta-lockup", "meta-lockup-dark", false]);
    // WhatsApp has no lockup: the mark.
    expect(planPartnerLogo("whatsapp", 32, "color", "en", undefined, "lockup")).toMatchObject({ kind: "raster", shape: "mark" });
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
    expect(c.kind).toBe("raster"); // the owner's wordmark (DS-3b)
    expect([c.light.image.file, c.light.tile, c.dark.image.file, c.dark.tile]).toEqual(["woocommerce-mark", true, "woocommerce-mark", true]);
    const m = planPartnerLogo("woocommerce", 40, "mono");
    expect([m.light.variant, m.light.tile, m.dark.variant, m.dark.tile]).toEqual(["black", false, "white", false]);
  });
  it("mono at rest shows the colour mark on its tile on hover and focus, where a colour file exists (D8)", () => {
    const m = planPartnerLogo("woocommerce", 40, "mono");
    expect(m.hoverRaster.file).toBe("woocommerce-mark"); // the owner's colour file, over the SVG
    expect(m.hover).toBeUndefined();
    expect(planPartnerLogo("woocommerce", 40).hoverRaster).toBeUndefined(); // colour already
  });
  it("keeps the guide's minimum size: below it, a monogram", () => {
    const woo = partnerBySlug("woocommerce");
    expect(planPartnerLogo("woocommerce", 23).kind).toBe("monogram"); // mark under its 16px minimum
    expect(planPartnerLogo("woocommerce", 23, "mono").kind).toBe("monogram");
    expect(planPartnerLogo("woocommerce", 24).kind).toBe("raster");
    const p = planPartnerLogo("woocommerce", 24, "mono");
    expect(p.kind).toBe("mark");
    expect(p.markPx).toBeGreaterThanOrEqual(woo.minPx);
    expect(p.markPx + 2 * p.padPx).toBe(24);
    expect(p.padPx).toBe(Math.round(24 * woo.clearSpace / (1 + 2 * woo.clearSpace)));
  });
  it("partnerMarkMinSize is the first size that draws the mark (the /ui gallery uses it)", () => {
    expect(partnerMarkMinSize("shopify")).toBe(24); // the owner's bag, from 16px with a quarter as clear space
    expect(partnerMarkMinSize("woocommerce")).toBe(24);
    expect(partnerMarkMinSize("bosta")).toBe(24);
    expect(partnerMarkMinSize("wordpress")).toBeUndefined();
    for (const e of P) {
      const s = partnerMarkMinSize(e.slug);
      if (s) expect(["mark", "raster"], e.slug).toContain(planPartnerLogo(e.slug, Math.max(96, s)).kind);
    }
  });
  it("monograms carry the brand's initial and its name in the reader's language", () => {
    expect(planPartnerLogo("mylerz", 32, "color", "ar")).toMatchObject({ kind: "monogram", text: "M", name: "مايلرز" });
    expect(planPartnerLogo("bosta", 32, "color", "ar")).toMatchObject({ kind: "raster", name: "بوسطة" });
    expect(planPartnerLogo("bosta", 16)).toMatchObject({ kind: "monogram", text: "B" }); // under the 16px mark
    expect(planPartnerLogo("jt", 32)).toMatchObject({ kind: "monogram", text: "J&T", name: "J&T Express" });
    expect(planPartnerLogo("whatsapp_cloud", 32)).toMatchObject({ kind: "raster", name: "WhatsApp" });
    expect(planPartnerLogo("unheard-of", 32)).toMatchObject({ kind: "monogram", text: "U", name: "unheard-of" });
    expect(planPartnerLogo("zatca", 32, "color", "ar")).toMatchObject({ kind: "text" });
    // An id the manifest does not know takes the caller's localized label, not the raw id.
    expect(planPartnerLogo("unheard-of", 32, "mono", "ar", "شركة جديدة")).toMatchObject({ kind: "monogram", name: "شركة جديدة" });
  });
  it("couriers without an API and other couriers have their own names and monograms, not Mylerz's M", () => {
    expect(planPartnerLogo("manual", 32, "color", "ar")).toMatchObject({ kind: "monogram", name: "يدوي" });
    expect(planPartnerLogo("other", 32, "color", "ar")).toMatchObject({ kind: "monogram", name: "شركة تانية" });
    expect(planPartnerLogo("other", 32)).toMatchObject({ name: "Other courier" });
    const m = planPartnerLogo("mylerz", 32).text;
    expect([planPartnerLogo("manual", 32).text, planPartnerLogo("other", 32).text]).not.toContain(m);
  });
});
