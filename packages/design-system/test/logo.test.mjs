import { existsSync, readdirSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ANDROID_SPLASH, BRAND_COPIES, ICO_SIZES, LAUNCH, PNGS, platformIcons, render, renderLaunch } from "../scripts/build-png.mjs";
import { isSafeSvg } from "../scripts/import-brand-pack.mjs";

const ds = new URL("../", import.meta.url);
const repo = new URL("../../../", import.meta.url);
const pixels = async (buf) => sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const meanDiff = (a, b) => { let d = 0; for (let i = 0; i < b.data.length; i++) d += Math.abs(a.data[i] - b.data[i]); return d / b.data.length; };

/**
 * Brand 2.0 raster files are their SVGs rendered at their size: a failed export, a stale file or an
 * SVG changed without `npm run build:png -w @mizan/design-system` fails here.
 */
describe("logo PNGs", () => {
  it.each(PNGS)("$png matches $svg at $size px", async (p) => {
    const file = readFileSync(new URL(`logo/png/${p.png}`, ds));
    const [have, want] = await Promise.all([pixels(file), pixels(await render(p))]);
    expect([have.info.width, have.info.height]).toEqual([p.size, p.size]);
    expect(meanDiff(have, want)).toBeLessThan(2);
  });

  it("the 1024 App Store icon is opaque", async () => {
    const meta = await sharp(readFileSync(new URL("logo/png/mizan-appicon-1024.png", ds))).metadata();
    expect(meta.hasAlpha).toBe(false);
  });

  it("logo/png holds exactly the generated set (no 1200 px pack exports, no 1.0 leftovers)", () => {
    expect(readdirSync(new URL("logo/png/", ds)).sort()).toEqual(PNGS.map((p) => p.png).sort());
  });
});

describe("favicon.ico", () => {
  it(`holds ${ICO_SIZES.length} PNG images: ${ICO_SIZES.join(", ")} px`, () => {
    const ico = readFileSync(new URL("logo/favicon.ico", ds));
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    expect(count).toBe(ICO_SIZES.length);
    const sizes = [];
    for (let i = 0; i < count; i++) {
      const e = 6 + 16 * i;
      sizes.push(ico.readUInt8(e) || 256);
      const offset = ico.readUInt32LE(e + 12);
      expect(ico.subarray(offset + 1, offset + 4).toString("latin1")).toBe("PNG");
    }
    expect(sizes).toEqual(ICO_SIZES);
  });
});

describe("the apps' copies", () => {
  it.each(BRAND_COPIES.map((c) => [c.to, c.from]))("%s equals %s", (to, from) => {
    expect(readFileSync(new URL(to, repo)).equals(readFileSync(new URL(from, ds)))).toBe(true);
  });

  it.each(["web", "admin"])("apps/%s/public/brand holds only the served Brand 2.0 files", (app) => {
    const want = BRAND_COPIES.filter((c) => c.to.startsWith(`apps/${app}/public/brand/`)).map((c) => c.to.split("/").pop()).sort();
    expect(readdirSync(new URL(`apps/${app}/public/brand/`, repo)).sort()).toEqual(want);
  });
});

describe("platform icons (opaque, no alpha)", () => {
  it.each(platformIcons().map((i) => [i.out, i]))("%s", async (_out, i) => {
    const buf = readFileSync(new URL(i.out, repo));
    const meta = await sharp(buf).metadata();
    expect([meta.width, meta.height]).toEqual([i.size, i.size]);
    expect(meta.hasAlpha).toBe(false);
    const [have, want] = await Promise.all([pixels(buf), pixels(await render(i))]);
    expect(meanDiff(have, want)).toBeLessThan(2);
  });

  it.each(LAUNCH.map((l) => [l.out, l]))("splash %s: the mark centred on paper", async (_out, l) => {
    const buf = readFileSync(new URL(l.out, repo));
    expect((await sharp(buf).metadata()).hasAlpha).toBe(false);
    const [have, want] = await Promise.all([pixels(buf), pixels(await renderLaunch(l))]);
    expect(meanDiff(have, want)).toBeLessThan(2);
  });
});

describe("Android splash marks (transparent, laid on paper or ink)", () => {
  it.each(ANDROID_SPLASH.map((a) => [a.out, a]))("%s", async (_out, a) => {
    const buf = readFileSync(new URL(a.out, repo));
    const meta = await sharp(buf).metadata();
    expect([meta.width, meta.height]).toEqual([a.size, a.size]);
    const [have, want] = await Promise.all([pixels(buf), pixels(await render(a))]);
    expect(meanDiff(have, want)).toBeLessThan(2);
  });
});

describe("Brand 2.0 SVGs", () => {
  const svgs = readdirSync(new URL("logo/svg/", ds));
  it("the pack's 24 logo files are committed under its names, and the 1.0 names are gone", () => {
    for (const base of ["mark", "wordmark", "wordmark-ar", "lockup", "bilingual"]) for (const v of ["", "-on-ink", "-mono-ink", "-mono-paper"]) expect(svgs).toContain(`mizan-${base}${v}.svg`);
    for (const f of ["mizan-appicon.svg", "mizan-appicon-paper.svg", "mizan-appicon-red.svg", "mizan-favicon.svg"]) expect(svgs).toContain(f);
    for (const gone of ["mizan-monogram.svg", "mizan-wordmark-on-dark.svg", "mizan-wordmark-mono-black.svg", "mizan-appicon-light.svg", "mizan-appicon-square.svg", "mizan-bilingual-on-dark.svg"]) expect(svgs).not.toContain(gone);
  });

  it("every SVG is inert (no scripts, handlers, foreignObject or external references)", () => {
    for (const dir of ["logo/svg/", "logo/animated/"]) for (const f of readdirSync(new URL(dir, ds))) expect(isSafeSvg(readFileSync(new URL(`${dir}${f}`, ds), "utf8")), f).toBe(true);
  });

  it("the mark is ink on the left and red on the right; on ink, paper and red-on-ink", () => {
    const mark = readFileSync(new URL("logo/svg/mizan-mark.svg", ds), "utf8");
    expect(mark.indexOf('stop-color="#0B0B0B"')).toBeLessThan(mark.indexOf('stop-color="#DE0000"'));
    const onInk = readFileSync(new URL("logo/svg/mizan-mark-on-ink.svg", ds), "utf8");
    expect(onInk).toContain("#FEF7FF");
    expect(onInk).toContain("#E33232");
    expect(readFileSync(new URL("logo/svg/mizan-mark-mono-ink.svg", ds), "utf8")).not.toMatch(/#DE0000|#E33232/i);
  });

  it("the animated loaders cover every loader in both colourways", () => {
    const anim = readdirSync(new URL("logo/animated/", ds)).sort();
    expect(anim).toEqual(["drop", "fill", "pair", "transfer"].flatMap((k) => [`mizan-${k}-on-ink.svg`, `mizan-${k}-on-paper.svg`]).sort());
  });

  it("MANIFEST.json records the pack, committed or not, by SHA-256", () => {
    const m = JSON.parse(readFileSync(new URL("logo/MANIFEST.json", ds), "utf8"));
    expect(m.files.length).toBeGreaterThan(100);
    for (const f of m.files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    const committed = m.files.filter((f) => f.committed).map((f) => f.path);
    expect(committed.filter((p) => /\.(mov|webm|mp4|gif|png)$/.test(p))).toEqual([]);
    // The on-paper pair, transfer and drop only: the ops app recolours them on ink (1.2 MB budget).
    expect(committed.filter((p) => p.startsWith("animated/lottie/"))).toEqual(["animated/lottie/mizan-drop-on-paper.json", "animated/lottie/mizan-pair-on-paper.json", "animated/lottie/mizan-transfer-on-paper.json"]);
    for (const p of committed.filter((x) => x.startsWith("animated/lottie/"))) expect(existsSync(new URL(`apps/ops/assets/lottie/${p.split("/").pop()}`, repo)), p).toBe(true);
  });
});
