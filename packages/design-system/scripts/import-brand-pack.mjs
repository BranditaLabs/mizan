#!/usr/bin/env node
/**
 * Imports the parts of a Brand 2.0 pack that are committed, and records the rest:
 *   node scripts/import-brand-pack.mjs <path to the extracted pack>
 *
 * The pack is data, never code: its component scripts are ported by hand (motion/, react/motion/)
 * and nothing in it is executed. This script:
 *   - copies logo/svg/*.svg to logo/svg/ and animated/svg/*.svg to logo/animated/ (refusing any SVG with
 *     scripts, event handlers, foreignObject or external references)
 *   - minifies the pair, transfer and drop Lottie files into apps/ops/assets/lottie/ (fill is painted natively)
 *   - writes logo/MANIFEST.json: name, bytes and SHA-256 of every pack file, and whether it is committed
 * Then run `npm run build:png` for the raster files.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ds = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(ds, "..", "..");
const LOTTIE = ["pair", "transfer", "drop"];
const UNSAFE = /<script|<foreignObject|\son[a-z]+\s*=|javascript:|(?:xlink:)?href\s*=\s*["'](?:https?:|\/\/|data:)|@import|url\(\s*["']?https?:/i;

/** Round every float to `dp` decimals and drop layer names: the shapes are unchanged at 960 px. */
export function minifyLottie(json, dp = 3) {
  const f = 10 ** dp;
  const walk = (o) => {
    if (typeof o === "number") return Number.isInteger(o) ? o : Math.round(o * f) / f;
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === "object") return Object.fromEntries(Object.entries(o).filter(([k]) => k !== "nm" && k !== "mn").map(([k, v]) => [k, walk(v)]));
    return o;
  };
  return JSON.stringify(walk(json));
}

export const isSafeSvg = (text) => !UNSAFE.test(text);

const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));

if (process.argv[1]?.endsWith("import-brand-pack.mjs")) {
  const pack = process.argv[2];
  if (!pack) { console.error("usage: node scripts/import-brand-pack.mjs <pack dir>"); process.exit(1); }
  const committed = new Set();
  for (const [from, to] of [["logo/svg", "logo/svg"], ["animated/svg", "logo/animated"]]) {
    mkdirSync(join(ds, to), { recursive: true });
    for (const f of readdirSync(join(pack, from)).filter((n) => n.endsWith(".svg"))) {
      if (!isSafeSvg(readFileSync(join(pack, from, f), "utf8"))) throw new Error(`refusing ${from}/${f}: active or external content`);
      copyFileSync(join(pack, from, f), join(ds, to, f));
      committed.add(`${from}/${f}`);
    }
  }
  const out = join(repo, "apps/ops/assets/lottie");
  mkdirSync(out, { recursive: true });
  for (const kind of LOTTIE) for (const bg of ["paper", "ink"]) {
    const name = `mizan-${kind}-on-${bg}.json`;
    writeFileSync(join(out, name), minifyLottie(JSON.parse(readFileSync(join(pack, "animated/lottie", name), "utf8"))));
    committed.add(`animated/lottie/${name}`);
  }
  const manifest = {
    $description: "Brand 2.0 pack (Brandita). Committed files are listed with their repo path; the rest (videos, GIFs, 1200 px PNGs, the brand page, the component scripts) live in Brandita's brand drive and are identified here by SHA-256.",
    files: files(pack).map((p) => {
      const rel = relative(pack, p).replace(/\\/g, "/");
      const buf = readFileSync(p);
      return { path: rel, bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), committed: committed.has(rel) };
    }).sort((a, b) => a.path.localeCompare(b.path)),
  };
  writeFileSync(join(ds, "logo/MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`imported ${committed.size} files; manifest lists ${manifest.files.length}`);
}
