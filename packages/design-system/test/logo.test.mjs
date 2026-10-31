import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { PNGS, render } from "../scripts/build-png.mjs";

const pixels = async (buf) => sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

/**
 * Every logo PNG is its SVG rendered at its size: a failed export (a broken-image placeholder, a
 * blank square) or an SVG changed without `npm run build:png` fails here.
 */
describe("logo PNGs", () => {
  it.each(PNGS)("$png matches $svg at $size px", async (p) => {
    const file = readFileSync(new URL(`../logo/png/${p.png}`, import.meta.url));
    const [have, want] = await Promise.all([pixels(file), pixels(await render(p))]);
    expect([have.info.width, have.info.height]).toEqual([p.size, p.size]);
    let diff = 0;
    for (let i = 0; i < want.data.length; i++) diff += Math.abs(have.data[i] - want.data[i]);
    expect(diff / want.data.length).toBeLessThan(2);
  });

  it("the dashboard serves the same PWA icons", () => {
    for (const name of ["mizan-appicon-192.png", "mizan-appicon-512.png"]) {
      const served = readFileSync(new URL(`../../../apps/web/public/brand/${name}`, import.meta.url));
      expect(served.equals(readFileSync(new URL(`../logo/png/${name}`, import.meta.url))), name).toBe(true);
    }
  });
});
