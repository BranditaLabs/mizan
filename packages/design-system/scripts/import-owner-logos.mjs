/**
 * Owner-supplied partner logos (DS-3b) → logos/partners/raster/: `npm run import:owner-logos -w
 * @mizan/design-system -- <folder with the owner's files>`. The folder is read only; nothing in it
 * is executed. Raster in, raster out: these files are bitmaps, so no vector is faked.
 *
 * For each logo:
 *   - decode (PNG, WebP, AVIF), make a flat background transparent (white, or WhatsApp's green
 *     square around the bubble) by un-mixing the anti-aliased edge so it stays clean, then trim;
 *   - "mark": the icon alone (Shopify's bag, Bosta's box, WhatsApp's bubble, Meta's infinity; Woo
 *     has no separate icon, so its wordmark fitted), centred on a transparent square;
 *   - "lockup": the whole logo where one exists, at a fixed height;
 *   - a dark face where a part is black or near-black (Shopify's and Meta's wordmarks turn white);
 *     coloured parts keep the brand colour and are checked against ink (3:1 for graphics);
 *   - 1x/2x/3x as palette PNG (lossless WebP came out larger at 2x/3x and near-lossless WebP saved
 *     ~15% at the cost of a <picture> per logo, so PNG only). Marks are 32 px at 1x (the tile's mark at the sizes the UI uses),
 *     lockups 24 px tall at 1x.
 *
 * Then `npm run build -w @mizan/design-system` puts their names and sizes in data.ts and copies
 * the files to apps/{web,admin}/public/partners.
 */
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ds = join(dirname(fileURLToPath(import.meta.url)), "..");
export const RASTER_DIR = join(ds, "logos/partners/raster");
export const MARK_PX = 32;
export const LOCKUP_PX = 24;
export const SCALES = [1, 2, 3];
const INK = [0x0b, 0x0b, 0x0b];

/**
 * One entry per owner file. `match` finds it in the folder; `mark` is the icon's share of the
 * trimmed logo along x (0..1, from the left), or "all"; `lockup` says whether the whole logo is a
 * lockup worth shipping; `knockout` the flat background colour to remove when the file is opaque.
 */
export const OWNER_LOGOS = [
  { slug: "bosta", match: /artboard/i, mark: [0, 0.33], lockup: true },
  { slug: "shopify", match: /^shopify/i, mark: [0, 0.27], lockup: true },
  { slug: "woocommerce", match: /woocommerce/i, mark: "all", lockup: true },
  { slug: "whatsapp", match: /whatsapp/i, mark: "all", lockup: false, knockout: "edge" },
  { slug: "meta", match: /^meta/i, mark: [0, 0.31], lockup: true },
];

const lum = ([r, g, b]) => {
  const c = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

async function decode(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: Buffer.from(data), w: info.width, h: info.height };
}

/**
 * Removes a flat background touching the image's edge. Pixels connected to the edge whose colour
 * is close to the background become transparent; pixels on the boundary that are a mix of the
 * background and the foreground next to them keep the foreground colour with alpha = its share
 * (so the edge stays anti-aliased, with no fringe of the old background).
 */
function knockout(img) {
  const { data, w, h } = img;
  const bg = [data[0], data[1], data[2]];
  const dist = (i, c) => Math.hypot(data[i] - c[0], data[i + 1] - c[1], data[i + 2] - c[2]);
  const outside = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop();
    if (outside[p] || dist(p * 4, bg) > 40) continue;
    outside[p] = 1;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1); if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w); if (y < h - 1) stack.push(p + w);
  }
  // The foreground colour nearest the background region: the most frequent opaque colour far from it.
  const fgCount = new Map();
  for (let p = 0; p < w * h; p++) if (!outside[p] && dist(p * 4, bg) > 200) { const k = `${data[p * 4]},${data[p * 4 + 1]},${data[p * 4 + 2]}`; fgCount.set(k, (fgCount.get(k) ?? 0) + 1); }
  const fg = [...fgCount].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
  const span = Math.hypot(fg[0] - bg[0], fg[1] - bg[1], fg[2] - bg[2]);
  const near = (p) => { const x = p % w, y = (p / w) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const q = (y + dy) * w + (x + dx); if (x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h && outside[q]) return true; } return false; };
  const out = Buffer.from(data);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (outside[p]) { out[i] = fg[0]; out[i + 1] = fg[1]; out[i + 2] = fg[2]; out[i + 3] = 0; continue; }
    if (!near(p)) continue;
    const a = Math.max(0, Math.min(1, dist(i, bg) / span));
    out[i] = fg[0]; out[i + 1] = fg[1]; out[i + 2] = fg[2]; out[i + 3] = Math.round(a * 255);
  }
  return { data: out, w, h, fg, bg };
}

/** The bounding box of pixels with alpha above a threshold. */
function bbox({ data, w, h }, x0 = 0, x1 = w) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) if (data[(y * w + x) * 4 + 3] > 8) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Black or near-black neutral pixels (a wordmark) turn white; every coloured pixel stays. */
function darkFace({ data, w, h }) {
  const out = Buffer.from(data);
  let changed = 0, solid = 0;
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    if (out[i + 3] > 128) solid++;
    const [r, g, b] = [out[i], out[i + 1], out[i + 2]];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max < 90 && max - min < 40) { out[i] = out[i + 1] = out[i + 2] = 255; if (out[i + 3] > 128) changed++; }
  }
  // Only a real dark part (a wordmark) earns a dark face, not a few dark edge pixels.
  return changed > solid * 0.01 ? { data: out, w, h } : null;
}

/** The brand colours left after the dark face (alpha-weighted, opaque pixels only), for the contrast check on ink. */
function colours({ data }) {
  const h = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 250) continue;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (Math.max(r, g, b) - Math.min(r, g, b) < 40) continue; // neutrals (white S, white ring)
    const k = `${r >> 4 << 4},${g >> 4 << 4},${b >> 4 << 4}`;
    h.set(k, (h.get(k) ?? 0) + 1);
  }
  const total = [...h.values()].reduce((a, b) => a + b, 0);
  return [...h].filter(([, n]) => n / total > 0.05).map(([k]) => k.split(",").map(Number));
}

const raw = (img) => sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } });

async function crop(img, box) {
  const { data, info } = await raw(img).extract(box).raw().toBuffer({ resolveWithObject: true });
  return { data: Buffer.from(data), w: info.width, h: info.height };
}

/** Writes name@{1,2,3}x.{png,webp}: a square of MARK_PX (the image fitted, centred) or LOCKUP_PX tall. */
async function write(img, name, kind) {
  const files = [];
  for (const k of SCALES) {
    const base = raw(img);
    const sized = kind === "mark"
      ? base.resize(MARK_PX * k, MARK_PX * k, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" })
      : base.resize({ height: LOCKUP_PX * k, kernel: "lanczos3" });
    const buf = await sized.png().toBuffer();
    const stem = `${name}@${k}x`;
    const png = await sharp(buf).png({ compressionLevel: 9, palette: true, quality: 100, effort: 10 }).toFile(join(RASTER_DIR, `${stem}.png`));
    files.push({ stem, w: png.width, h: png.height, bytes: png.size });
  }
  return files;
}

export async function importOwnerLogos(dir) {
  rmSync(RASTER_DIR, { recursive: true, force: true });
  mkdirSync(RASTER_DIR, { recursive: true });
  const present = readdirSync(dir);
  const report = [];
  for (const spec of OWNER_LOGOS) {
    const file = present.find((f) => spec.match.test(f));
    if (!file) throw new Error(`${spec.slug}: no file matching ${spec.match} in ${dir}`);
    let img = await decode(join(dir, file));
    const opaque = img.data[3] === 255;
    if (spec.knockout || opaque) img = knockout(img);
    img = await crop(img, bbox(img));
    const out = { slug: spec.slug, file, faces: {} };

    const markImg = spec.mark === "all" ? img : await crop(img, bbox(img, Math.round(spec.mark[0] * img.w), Math.round(spec.mark[1] * img.w)));
    out.faces.mark = await write(markImg, `${spec.slug}-mark`, "mark");
    // A mark sits on its light tile in both themes, so it needs no dark face unless it has dark parts.
    const markDark = darkFace(markImg);
    if (markDark) out.faces["mark-dark"] = await write(markDark, `${spec.slug}-mark-dark`, "mark");

    if (spec.lockup) {
      out.faces.lockup = await write(img, `${spec.slug}-lockup`, "lockup");
      const dark = darkFace(img);
      if (dark) out.faces["lockup-dark"] = await write(dark, `${spec.slug}-lockup-dark`, "lockup");
      out.aspect = img.w / img.h;
    }
    out.onInk = colours(darkFace(img) ?? img).map((c) => ({ colour: `rgb(${c.join(",")})`, contrast: +contrast(c, INK).toFixed(2) }));
    report.push(out);
  }
  return report;
}

if (process.argv[1]?.endsWith("import-owner-logos.mjs")) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: import-owner-logos.mjs <folder with the owner's logo files>"); process.exit(1); }
  const report = await importOwnerLogos(dir);
  for (const r of report) {
    console.log(`${r.slug} (${r.file})`);
    for (const [face, files] of Object.entries(r.faces)) console.log(`  ${face}: ${files.map((f) => `${f.stem} ${f.w}x${f.h} ${f.bytes} B`).join("; ")}`);
    console.log(`  on ink: ${r.onInk.map((c) => `${c.colour} ${c.contrast}:1${c.contrast < 3 ? " (UNDER 3:1)" : ""}`).join(", ")}`);
  }
}
