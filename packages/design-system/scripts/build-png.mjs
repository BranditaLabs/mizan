// Brand 2.0 raster files from their SVG sources: `npm run build:png -w @mizan/design-system`.
// The SVGs draw every shape as a path, so a plain rasteriser renders them exactly; sharp comes
// with Next.js in this workspace. The pack's 1200 px PNGs are never committed: the SVGs are the source.
//
// Writes:
//   logo/png/*                          app icons, the paper app icon, favicons
//   logo/favicon.ico                    16, 32, 48 and 64 px, copied to apps/{web,admin}/src/app/favicon.ico
//   apps/{web,admin}/src/app/icon.svg   the favicon SVG
//   apps/web/src/app/apple-icon.png     180 px, opaque
//   apps/{web,admin}/public/brand/*     the SVGs the apps serve (BRAND_COPIES) and the PWA icons
//   apps/ops (Android mipmaps, iOS AppIcon set, LaunchImage)   opaque, no alpha
//   apps/ops Android splash_mark (drawable-*dpi, drawable-night-*dpi)   transparent
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ds = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(ds, "..", "..");
export const INK = "#0B0B0B";
export const PAPER = "#FEF7FF";

/**
 * `flatten`: the colour laid under transparent pixels (an opaque icon). The app icon's own
 * background is ink, so its rounded corners are flattened onto ink: iOS and Android apply their own
 * mask, and a paper fringe would show at the edge of that mask.
 */
export const PNGS = [
  { svg: "mizan-appicon.svg", png: "mizan-appicon-1024.png", size: 1024, flatten: INK },
  { svg: "mizan-appicon.svg", png: "mizan-appicon-512.png", size: 512 },
  { svg: "mizan-appicon.svg", png: "mizan-appicon-192.png", size: 192 },
  { svg: "mizan-appicon.svg", png: "mizan-appicon-180.png", size: 180 },
  { svg: "mizan-appicon-paper.svg", png: "mizan-appicon-paper-512.png", size: 512 },
  { svg: "mizan-favicon.svg", png: "mizan-favicon-64.png", size: 64 },
  { svg: "mizan-favicon.svg", png: "mizan-favicon-48.png", size: 48 },
  { svg: "mizan-favicon.svg", png: "mizan-favicon-32.png", size: 32 },
  { svg: "mizan-favicon.svg", png: "mizan-favicon-16.png", size: 16 },
];

export const ICO_SIZES = [16, 32, 48, 64];

/** The SVGs each app serves from public/brand (the marks and wordmarks the components point at). */
const SERVED = ["mizan-mark", "mizan-wordmark", "mizan-wordmark-ar", "mizan-lockup", "mizan-bilingual"]
  .flatMap((n) => ["", "-on-ink", "-mono-ink", "-mono-paper"].map((v) => `${n}${v}.svg`));
export const BRAND_COPIES = [
  ...SERVED.map((f) => ({ from: `logo/svg/${f}`, to: `apps/web/public/brand/${f}` })),
  ...SERVED.map((f) => ({ from: `logo/svg/${f}`, to: `apps/admin/public/brand/${f}` })),
  { from: "logo/png/mizan-appicon-192.png", to: "apps/web/public/brand/mizan-appicon-192.png" },
  { from: "logo/png/mizan-appicon-512.png", to: "apps/web/public/brand/mizan-appicon-512.png" },
  { from: "logo/svg/mizan-favicon.svg", to: "apps/web/src/app/icon.svg" },
  { from: "logo/svg/mizan-favicon.svg", to: "apps/admin/src/app/icon.svg" },
  { from: "logo/favicon.ico", to: "apps/web/src/app/favicon.ico" },
  { from: "logo/favicon.ico", to: "apps/admin/src/app/favicon.ico" },
  // The no-JS fallback of the waiting screens (OutageScreen <noscript>): the SMIL pair, never used in the live app.
  { from: "logo/animated/mizan-pair-on-paper.svg", to: "apps/web/public/motion/mizan-pair-on-paper.svg" },
  { from: "logo/animated/mizan-pair-on-paper.svg", to: "apps/admin/public/motion/mizan-pair-on-paper.svg" },
];

const IOS = "apps/ops/ios/Runner/Assets.xcassets";
const ANDROID = "apps/ops/android/app/src/main/res";

/** Opaque app-platform icons: [{ svg, out (repo path), size, flatten }]. */
export function platformIcons() {
  const icons = [
    { svg: "mizan-appicon.svg", out: "apps/web/src/app/apple-icon.png", size: 180, flatten: INK },
    ...[["m", 48], ["h", 72], ["xh", 96], ["xxh", 144], ["xxxh", 192]].map(([d, size]) => ({ svg: "mizan-appicon.svg", out: `${ANDROID}/mipmap-${d}dpi/ic_launcher.png`, size, flatten: INK })),
  ];
  const contents = JSON.parse(readFileSync(join(repo, IOS, "AppIcon.appiconset/Contents.json"), "utf8"));
  const seen = new Set();
  for (const i of contents.images) {
    if (!i.filename || seen.has(i.filename)) continue;
    seen.add(i.filename);
    const size = Math.round(parseFloat(i.size) * parseInt(i.scale, 10));
    icons.push({ svg: "mizan-appicon.svg", out: `${IOS}/AppIcon.appiconset/${i.filename}`, size, flatten: INK });
  }
  return icons;
}

/** The ops splash (D3): the mark centred on paper, 1x/2x/3x of a 200 pt square. */
export const LAUNCH = [1, 2, 3].map((k) => ({ svg: "mizan-mark.svg", out: `${IOS}/LaunchImage.imageset/LaunchImage${k > 1 ? `@${k}x` : ""}.png`, size: 200 * k, mark: 120 * k, flatten: PAPER }));

/**
 * The Android splash (D3): the mark as a transparent 120 dp bitmap laid on the window colour
 * (launch_background.xml): paper by day with mizan-mark, ink at night with mizan-mark-on-ink.
 */
export const ANDROID_SPLASH = [["m", 1], ["h", 1.5], ["xh", 2], ["xxh", 3], ["xxxh", 4]].flatMap(([d, k]) => [
  { svg: "mizan-mark.svg", out: `${ANDROID}/drawable-${d}dpi/splash_mark.png`, size: 120 * k },
  { svg: "mizan-mark-on-ink.svg", out: `${ANDROID}/drawable-night-${d}dpi/splash_mark.png`, size: 120 * k },
]);

const svgPath = (f) => join(ds, "logo/svg", f);

/** One square PNG rendered from its SVG at its size (density scales the vector, never the bitmap). */
export async function render({ svg, size, flatten }) {
  const source = readFileSync(svgPath(svg));
  const { width, height } = await sharp(source).metadata();
  let img = sharp(source, { density: Math.max(72, (72 * size) / Math.max(width, height)) }).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
  if (flatten) img = img.flatten({ background: flatten }).removeAlpha();
  return img.png({ compressionLevel: 9 }).toBuffer();
}

/** The mark centred on a paper square (the splash). */
export async function renderLaunch({ svg, size, mark, flatten }) {
  const source = readFileSync(svgPath(svg));
  const { width } = await sharp(source).metadata();
  const art = await sharp(source, { density: (72 * mark) / width }).resize({ width: mark }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: flatten } })
    .composite([{ input: art, gravity: "centre" }]).flatten({ background: flatten }).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
}

/** A Windows icon holding one PNG per size (PNG-in-ICO, read by every current browser). */
export function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

const write = (rel, buf) => { const p = join(repo, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, buf); console.log(`wrote ${rel}`); };

if (process.argv[1]?.endsWith("build-png.mjs")) {
  for (const p of PNGS) write(`packages/design-system/logo/png/${p.png}`, await render(p));
  write("packages/design-system/logo/favicon.ico", ico(ICO_SIZES.map((size) => ({ size, data: readFileSync(join(ds, `logo/png/mizan-favicon-${size}.png`)) }))));
  for (const i of platformIcons()) write(i.out, await render(i));
  for (const l of LAUNCH) write(l.out, await renderLaunch(l));
  for (const a of ANDROID_SPLASH) write(a.out, await render(a));
  // public/brand holds exactly the served set: old 1.0 names are removed, never kept as copies.
  const keep = new Set(BRAND_COPIES.map((c) => c.to));
  for (const app of ["web", "admin"]) {
    const dir = join(repo, `apps/${app}/public/brand`);
    if (existsSync(dir)) for (const f of readdirSync(dir)) if (!keep.has(`apps/${app}/public/brand/${f}`)) { rmSync(join(dir, f)); console.log(`removed apps/${app}/public/brand/${f}`); }
  }
  for (const c of BRAND_COPIES) { mkdirSync(dirname(join(repo, c.to)), { recursive: true }); copyFileSync(join(ds, c.from), join(repo, c.to)); }
  console.log(`copied ${BRAND_COPIES.length} brand files into the apps`);
}
