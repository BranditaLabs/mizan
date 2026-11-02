// Logo PNGs from their SVG sources (app icons, PWA icons, favicons): `npm run build:png`.
// The SVGs draw every letter as a path, so a plain rasteriser renders them exactly; sharp comes
// with Next.js in this workspace. The dashboard's PWA icons are copied to apps/web/public/brand.
import { copyFileSync, readFileSync } from "node:fs";
import sharp from "sharp";

export const PNGS = [
  { svg: "mizan-appicon.svg", png: "mizan-appicon-1024.png", size: 1024 },
  { svg: "mizan-appicon.svg", png: "mizan-appicon-512.png", size: 512 },
  { svg: "mizan-appicon.svg", png: "mizan-appicon-192.png", size: 192 },
  { svg: "mizan-appicon.svg", png: "mizan-appicon-180.png", size: 180 },
  { svg: "mizan-appicon-light.svg", png: "mizan-appicon-light-512.png", size: 512 },
  { svg: "mizan-appicon-square.svg", png: "mizan-appicon-square-1024.png", size: 1024 },
  { svg: "mizan-favicon.svg", png: "mizan-favicon-64.png", size: 64 },
  { svg: "mizan-favicon.svg", png: "mizan-favicon-48.png", size: 48 },
  { svg: "mizan-favicon.svg", png: "mizan-favicon-32.png", size: 32 },
  { svg: "mizan-favicon.svg", png: "mizan-favicon-16.png", size: 16 },
];

const logo = new URL("../logo/", import.meta.url);

/** One PNG rendered from its SVG at its size (density scales the vector, never the bitmap). */
export async function render({ svg, size }) {
  const source = readFileSync(new URL(`svg/${svg}`, logo));
  const { width } = await sharp(source).metadata();
  return sharp(source, { density: Math.max(72, (72 * size) / width) }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("build-png.mjs")) {
  for (const p of PNGS) {
    await sharp(await render(p)).toFile(new URL(`png/${p.png}`, logo).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    console.log(`wrote logo/png/${p.png}`);
  }
  for (const name of ["mizan-appicon-192.png", "mizan-appicon-512.png"]) {
    copyFileSync(new URL(`png/${name}`, logo), new URL(`../../../apps/web/public/brand/${name}`, import.meta.url));
    console.log(`copied ${name} to apps/web/public/brand`);
  }
}
