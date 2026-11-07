// The Brand 2.0 asset budget (runs first in `npm test -w @mizan/design-system`). Fails when:
//   - a video or GIF (.mov .webm .mp4 .gif) sits anywhere under apps/ or packages/ (they live in the brand drive)
//   - one file is over 500 KB, outside the allowlist (fonts, the ops Lottie files, generated reference/docs)
//   - logo/svg is over 200 KB, logo/animated over 100 KB, apps/ops/assets/lottie over its cap
//   - the minified gzip bundle of react/motion (the motion core and the loaders) is over 14 KB, or of
//     react/motion/instruments over 12 KB (react and @mizan/shared external, as in the apps)
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const ds = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(ds, "..", "..");
const KB = 1024;

export const LIMITS = {
  file: 500 * KB,
  logoSvg: 200 * KB,
  logoAnimated: 100 * KB,
  // The plan's 1.2 MB (docs/16 §3): the on-paper files only (the ops app recolours them on ink with
  // a colour matrix) and coordinates at 1 decimal of the 960 px canvas.
  lottie: 1.2 * 1024 * KB,
  loadersGz: 14 * KB,
  instrumentsGz: 12 * KB,
};

const SKIP = new Set(["node_modules", ".next", "dist-e2e", ".turbo", "build", ".dart_tool", "coverage", ".git", "Pods", "graphify-out"]);
const ALLOW = [/\.(woff2|ttf|otf)$/, /^apps\/ops\/assets\/lottie\//, /^packages\/design-system\/reference\/index\.html$/, /^packages\/design-system\/Mizan-Design-System\.pdf$/, /^apps\/api\/openapi\.json$/, /^apps\/(web|admin)\/messages\//, /^packages\/db\/src\/schema\.ts$/, /package-lock\.json$/, /\.(test|spec)\.[jt]sx?$/, /^apps\/(web|admin)\/src\/lib\/api\/schema\.d\.ts$/, /\/__snapshots__\//];

function* walk(dir) {
  for (const f of readdirSync(dir)) {
    if (SKIP.has(f)) continue;
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p); else yield [p, st.size];
  }
}
const sizeOf = (dir) => { let n = 0; for (const [, s] of walk(dir)) n += s; return n; };
/** Minified, bundled and gzipped, the way an app ships it. */
async function gzBundle(entry) {
  const out = await build({ entryPoints: [join(ds, entry)], bundle: true, minify: true, write: false, format: "esm", platform: "browser", jsx: "automatic", external: ["react", "react/*", "react-dom", "@mizan/shared", "@mizan/shared/*"], logLevel: "silent" });
  return gzipSync(out.outputFiles[0].contents).length;
}

export async function check() {
  const problems = [];
  for (const root of ["apps", "packages"]) {
    for (const [p, size] of walk(join(repo, root))) {
      const rel = relative(repo, p).replace(/\\/g, "/");
      if (/\.(mov|webm|mp4|gif)$/i.test(rel)) problems.push(`${rel}: videos and GIFs stay in the brand drive (logo/MANIFEST.json)`);
      else if (size > LIMITS.file && !ALLOW.some((re) => re.test(rel))) problems.push(`${rel}: ${(size / KB).toFixed(0)} KB > 500 KB`);
    }
  }
  const caps = [["packages/design-system/logo/svg", LIMITS.logoSvg], ["packages/design-system/logo/animated", LIMITS.logoAnimated], ["apps/ops/assets/lottie", LIMITS.lottie]];
  for (const [dir, cap] of caps) { const n = sizeOf(join(repo, dir)); if (n > cap) problems.push(`${dir}: ${(n / KB).toFixed(0)} KB > ${(cap / KB).toFixed(0)} KB`); }
  const lg = await gzBundle("react/motion/index.ts"), ig = await gzBundle("react/motion/instruments/index.ts");
  if (lg > LIMITS.loadersGz) problems.push(`motion + react/motion loaders: ${(lg / KB).toFixed(1)} KB gzip > 14 KB`);
  if (ig > LIMITS.instrumentsGz) problems.push(`instruments: ${(ig / KB).toFixed(1)} KB gzip > 12 KB`);
  return { problems, sizes: { loadersGz: lg, instrumentsGz: ig } };
}

if (process.argv[1]?.endsWith("asset-budget.mjs")) {
  const { problems, sizes } = await check();
  if (problems.length) { console.error(`asset budget:\n  ${problems.join("\n  ")}`); process.exit(1); }
  console.log(`asset budget ok (loaders ${(sizes.loadersGz / KB).toFixed(1)} KB gz, instruments ${(sizes.instrumentsGz / KB).toFixed(1)} KB gz)`);
}
