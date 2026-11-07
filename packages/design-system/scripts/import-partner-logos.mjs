#!/usr/bin/env node
/**
 * Copies partner marks from an extracted simple-icons package into logos/partners (docs/16 §5.9).
 * The package itself is never a dependency: download the pinned version, extract it, point this at it.
 *
 *   npm pack simple-icons@16.35.0 && tar xzf simple-icons-16.35.0.tgz   (in a scratch folder)
 *   node scripts/import-partner-logos.mjs <scratch>/package
 *
 * Only the variants an entry's allowedVariants lists are written: <slug>.svg (the brand colour),
 * <slug>-black.svg and <slug>-white.svg (the brand's one-colour versions). Files for variants that
 * are no longer allowed are removed. The path data is copied unchanged: never redrawn or traced.
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "logos/partners");
const pkg = process.argv[2];
if (!pkg || !existsSync(join(pkg, "package.json"))) {
  console.error("usage: node scripts/import-partner-logos.mjs <extracted simple-icons package dir>");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(dir, "partners.json"), "utf8"));
const version = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version;
if (version !== manifest.simpleIcons) {
  console.error(`simple-icons ${version} given, partners.json pins ${manifest.simpleIcons}`);
  process.exit(1);
}
const data = JSON.parse(readFileSync(join(pkg, "data/simple-icons.json"), "utf8"));
const icons = new Map((Array.isArray(data) ? data : data.icons).map((i) => [i.slug, i]));

const FILE = { color: (s) => `${s}.svg`, black: (s) => `${s}-black.svg`, white: (s) => `${s}-white.svg` };
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const svg = (title, d, fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img"><title>${esc(title)}</title><path fill="${fill}" d="${d}"/></svg>\n`;

const keep = new Set();
for (const e of manifest.partners) {
  if (e.monogram || !e.simpleIcons) continue;
  const icon = icons.get(e.simpleIcons);
  if (!icon) throw new Error(`${e.slug}: simple-icons ${version} has no "${e.simpleIcons}"`);
  const d = /<path d="([^"]+)"/.exec(readFileSync(join(pkg, "icons", `${e.simpleIcons}.svg`), "utf8"))?.[1];
  if (!d) throw new Error(`${e.slug}: no path in icons/${e.simpleIcons}.svg`);
  const fills = { color: `#${icon.hex}`, black: "#000000", white: "#FFFFFF" };
  for (const v of e.allowedVariants) {
    if (!(v in FILE)) throw new Error(`${e.slug}: variant "${v}" needs a press-kit file, not simple-icons`);
    writeFileSync(join(dir, FILE[v](e.slug)), svg(e.nameEn, d, fills[v]));
    keep.add(FILE[v](e.slug));
  }
}
// Stale simple-icons variants go; press-kit files (any other name) are never touched.
const ours = new Set(manifest.partners.filter((e) => e.simpleIcons).flatMap((e) => Object.values(FILE).map((f) => f(e.slug))));
for (const f of readdirSync(dir)) if (ours.has(f) && !keep.has(f)) rmSync(join(dir, f));
console.log(`partner logos imported from simple-icons ${version}: ${[...keep].filter((f) => f.endsWith(".svg")).length} files`);
