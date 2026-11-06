#!/usr/bin/env node
/**
 * Builds logos/partners/data.ts from partners.json and the SVG files beside it, so PartnerLogo
 * renders inline marks without an asset pipeline (web, admin and the landing alike).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "logos/partners");
const manifest = JSON.parse(readFileSync(join(dir, "partners.json"), "utf8"));
const FILE = { color: (s) => `${s}.svg`, black: (s) => `${s}-black.svg`, white: (s) => `${s}-white.svg`, "on-dark": (s) => `${s}-on-dark.svg` };

const marks = {};
for (const e of manifest.partners) {
  if (e.monogram) continue;
  for (const v of e.allowedVariants) {
    const f = join(dir, FILE[v](e.slug));
    if (!existsSync(f)) throw new Error(`${e.slug}: ${v} is allowed but ${FILE[v](e.slug)} is missing`);
    const svg = readFileSync(f, "utf8");
    const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
    const paths = [...svg.matchAll(/<path([^>]*)\/?>/g)].map(([, attrs]) => ({ d: /\sd="([^"]+)"/.exec(attrs)?.[1], fill: /fill="([^"]+)"/.exec(attrs)?.[1] }));
    if (!viewBox || paths.length === 0 || paths.some((p) => !p.d || !p.fill)) throw new Error(`${FILE[v](e.slug)}: expected a viewBox and filled paths`);
    (marks[e.slug] ??= {})[v] = { viewBox, paths };
  }
}

const partners = manifest.partners.map(({ slug, kind, nameEn, nameAr, source, guideUrl, allowedVariants, minPx, clearSpace, hasDark, monogram, monogramText, textOnly, aliases, guideCheckedAt }) =>
  ({ slug, kind, nameEn, nameAr, source, guideUrl, allowedVariants, minPx, clearSpace, hasDark, monogram, ...(monogramText ? { monogramText } : {}), ...(textOnly ? { textOnly } : {}), ...(aliases ? { aliases } : {}), guideCheckedAt }));

writeFileSync(join(dir, "data.ts"), `/* Generated from logos/partners/partners.json and its SVG files by scripts/build-partners.mjs. Do not edit. */
import type { PartnerEntry, PartnerMark } from "./types";

export const SIMPLE_ICONS_VERSION = ${JSON.stringify(manifest.simpleIcons)};

export const PARTNERS: readonly PartnerEntry[] = ${JSON.stringify(partners, null, 2)};

export const MARKS: Readonly<Record<string, Partial<Record<"color" | "black" | "white" | "on-dark", PartnerMark>>>> = ${JSON.stringify(marks, null, 2)};
`);
console.log(`partner logos built: ${partners.length} partners, ${Object.keys(marks).length} with a mark`);
