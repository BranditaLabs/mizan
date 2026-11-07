#!/usr/bin/env node
/**
 * Builds logos/partners/data.ts from partners.json and the SVG files beside it, so PartnerLogo
 * renders inline marks without an asset pipeline (web, admin and the landing alike). The
 * owner-supplied bitmaps in logos/partners/raster (DS-3b) are listed with their sizes, and copied to
 * apps/{web,admin}/public/partners, where PartnerLogo's <img> points.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "logos/partners");
const manifest = JSON.parse(readFileSync(join(dir, "partners.json"), "utf8"));
const FILE = { color: (s) => `${s}.svg`, black: (s) => `${s}-black.svg`, white: (s) => `${s}-white.svg`, "on-dark": (s) => `${s}-on-dark.svg` };

const rasterDir = join(dir, "raster");
const RASTER_COPIES = ["apps/web/public/partners", "apps/admin/public/partners"];
const rasterFiles = existsSync(rasterDir) ? readdirSync(rasterDir).filter((f) => f.endsWith(".png")) : [];
/** PNG size from its IHDR chunk. */
const pngSize = (f) => { const b = readFileSync(join(rasterDir, f)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

const rasters = {};
for (const e of manifest.partners) {
  if (!e.raster) continue;
  const r = { minPx: e.raster.minPx, ...(e.raster.lockupMinPx ? { lockupMinPx: e.raster.lockupMinPx } : {}), ...(e.raster.clearSpace ? { clearSpace: e.raster.clearSpace } : {}) };
  for (const shape of ["mark", "lockup"]) {
    for (const face of ["", "-dark"]) {
      const stem = `${e.slug}-${shape}${face}`;
      if (!rasterFiles.includes(`${stem}@1x.png`)) continue;
      const widths = [1, 2, 3].map((k) => {
        if (!rasterFiles.includes(`${stem}@${k}x.png`)) throw new Error(`raster/${stem}@${k}x.png is missing`);
        return pngSize(`${stem}@${k}x.png`).w;
      });
      const { w, h } = pngSize(`${stem}@1x.png`);
      ((r[shape] ??= {})[face ? "dark" : "light"] = { file: stem, w, h, widths });
    }
  }
  if (!r.mark?.light) throw new Error(`${e.slug}: raster is declared but raster/${e.slug}-mark@1x.png is missing (npm run import:owner-logos)`);
  rasters[e.slug] = r;
}
const unclaimed = rasterFiles.filter((f) => !Object.keys(rasters).some((s) => f.startsWith(`${s}-`)));
if (unclaimed.length) throw new Error(`raster files without a manifest entry: ${unclaimed.join(", ")}`);

const marks = {};
for (const e of manifest.partners) {
  if (e.monogram) continue;
  for (const v of e.allowedVariants) {
    const f = join(dir, FILE[v](e.slug));
    if (!existsSync(f) && v === "color" && rasters[e.slug]) continue; // the colour face is the owner's bitmap
    if (!existsSync(f)) throw new Error(`${e.slug}: ${v} is allowed but ${FILE[v](e.slug)} is missing`);
    const svg = readFileSync(f, "utf8");
    const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
    const paths = [...svg.matchAll(/<path([^>]*)\/?>/g)].map(([, attrs]) => ({ d: /\sd="([^"]+)"/.exec(attrs)?.[1], fill: /fill="([^"]+)"/.exec(attrs)?.[1] }));
    if (!viewBox || paths.length === 0 || paths.some((p) => !p.d || !p.fill)) throw new Error(`${FILE[v](e.slug)}: expected a viewBox and filled paths`);
    (marks[e.slug] ??= {})[v] = { viewBox, paths };
  }
}

const partners = manifest.partners.map(({ slug, kind, nameEn, nameAr, source, guideUrl, allowedVariants, minPx, clearSpace, hasDark, monogram, monogramText, textOnly, aliases, guideCheckedAt, permission, raster }) =>
  ({ slug, kind, nameEn, nameAr, source, guideUrl, allowedVariants, minPx, clearSpace, hasDark, monogram, ...(monogramText ? { monogramText } : {}), ...(textOnly ? { textOnly } : {}), ...(aliases ? { aliases } : {}), guideCheckedAt, ...(permission ? { permission } : {}), ...(raster ? { rasterSource: raster.source } : {}) }));

// The apps serve the bitmaps from /partners: a fresh copy each build, so a removed file goes too.
const repo = join(root, "..", "..");
for (const to of RASTER_COPIES) {
  const out = join(repo, to);
  rmSync(out, { recursive: true, force: true });
  if (!rasterFiles.length) continue;
  mkdirSync(out, { recursive: true });
  for (const f of rasterFiles) copyFileSync(join(rasterDir, f), join(out, f));
}

writeFileSync(join(dir, "data.ts"), `/* Generated from logos/partners/partners.json and its SVG files by scripts/build-partners.mjs. Do not edit. */
import type { PartnerEntry, PartnerMark, PartnerRaster } from "./types";

export const SIMPLE_ICONS_VERSION = ${JSON.stringify(manifest.simpleIcons)};

export const PARTNERS: readonly PartnerEntry[] = ${JSON.stringify(partners, null, 2)};

export const MARKS: Readonly<Record<string, Partial<Record<"color" | "black" | "white" | "on-dark", PartnerMark>>>> = ${JSON.stringify(marks, null, 2)};

/** Owner-supplied bitmaps (DS-3b): served from /partners/<file>@<1|2|3>x.png; w and h are the 1x size in px. */
export const RASTERS: Readonly<Record<string, PartnerRaster>> = ${JSON.stringify(rasters, null, 2)};
`);
console.log(`partner logos built: ${partners.length} partners, ${Object.keys(marks).length} with a mark, ${Object.keys(rasters).length} with an owner bitmap (${rasterFiles.length} files copied to ${RASTER_COPIES.join(", ")})`);
