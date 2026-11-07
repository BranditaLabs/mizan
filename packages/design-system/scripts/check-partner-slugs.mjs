#!/usr/bin/env node
/**
 * Checks every simple-icons entry in logos/partners/partners.json against the pinned version
 * (docs/16 §5.9): the slug still exists in that version's data/simple-icons.json (brands ask for
 * removals, and rename: Woo), its hex is the one in our colour file, and every committed file
 * carries that version's path unchanged.
 *
 *   node scripts/check-partner-slugs.mjs                 # reads the pinned version from cdn.jsdelivr.net
 *   node scripts/check-partner-slugs.mjs <package dir>   # or an extracted `npm pack simple-icons@<version>`
 *
 * Exit 1 lists every problem. Needs the network without a directory, so it is not part of `npm test`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "logos/partners");
const manifest = JSON.parse(readFileSync(join(dir, "partners.json"), "utf8"));
const version = manifest.simpleIcons;
const local = process.argv[2];

async function get(rel) {
  if (local) return readFileSync(join(local, rel), "utf8");
  const url = `https://cdn.jsdelivr.net/npm/simple-icons@${version}/${rel}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

if (local) {
  const have = JSON.parse(readFileSync(join(local, "package.json"), "utf8")).version;
  if (have !== version) { console.error(`package dir is simple-icons ${have}; partners.json pins ${version}`); process.exit(1); }
}

const data = JSON.parse(await get("data/simple-icons.json"));
const icons = new Map((Array.isArray(data) ? data : data.icons).map((i) => [i.slug, i]));
const problems = [];
const pathOf = (svg) => /<path[^>]* d="([^"]+)"/.exec(svg)?.[1];

for (const e of manifest.partners.filter((p) => p.simpleIcons)) {
  if (e.source !== `simple-icons@${version}`) problems.push(`${e.slug}: source "${e.source}" is not simple-icons@${version}`);
  const icon = icons.get(e.simpleIcons);
  if (!icon) { problems.push(`${e.slug}: "${e.simpleIcons}" is not in simple-icons ${version} (removed or renamed: record it as monogram: true with a note)`); continue; }
  if (e.monogram) continue;
  const want = pathOf(await get(`icons/${e.simpleIcons}.svg`));
  for (const v of e.allowedVariants) {
    const file = join(dir, v === "color" ? `${e.slug}.svg` : `${e.slug}-${v}.svg`);
    if (!existsSync(file)) { problems.push(`${e.slug}: ${v} is allowed but ${file} is missing`); continue; }
    const svg = readFileSync(file, "utf8");
    if (pathOf(svg) !== want) problems.push(`${e.slug}: ${v} file path differs from simple-icons ${version}`);
    if (v === "color" && !svg.includes(`fill="#${icon.hex}"`)) problems.push(`${e.slug}: colour file is not #${icon.hex}`);
  }
}

if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log(`partner slugs ok against simple-icons ${version}: ${manifest.partners.filter((p) => p.simpleIcons).length} entries`);
