import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * DS-1 (docs/16 §2.3): Brandita's motion, type steps, Geist 800/900 and the island edge, added
 * without touching the Mizan palette (owner decision D1).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = JSON.parse(readFileSync(join(root, "tokens/tokens.json"), "utf8"));
const read = (f) => readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n");
const keys = (o) => Object.keys(o).filter((k) => !k.startsWith("$"));
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

// WCAG relative luminance of an 8-bit RGB triple, and the colour of rgba(...) laid over a hex background.
const lum = ([r, g, b]) => { const c = [r, g, b].map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const over = (rgba, bgHex) => { const [r, g, b, a] = rgba.match(/[\d.]+/g).map(Number); return hex(bgHex).map((c, i) => Math.round([r, g, b][i] * a + c * (1 - a))); };
const ratio = (x, y) => { const [p, q] = [lum(x), lum(y)].sort((m, n) => n - m); return (p + 0.05) / (q + 0.05); };
const dark = (k) => T.color.dark[k].$value;

describe("motion ported from the Brandita site", () => {
  // C:/Users/ahmed/Brandita/web/src/styles/tokens.css: --ease, --ease-spring, --ease-sheet
  it("keeps the site's easings under Mizan's names", () => {
    expect(T.motion.easing.enter).toBe("cubic-bezier(0.23, 1, 0.32, 1)");
    expect(T.motion.easing.spring).toBe("cubic-bezier(0.34, 1.56, 0.64, 1)");
    expect(T.motion.easing.expand).toBe("cubic-bezier(0.32, 0.72, 0, 1)");
    const css = read("dist/tokens.css");
    expect(css).toContain("--mz-ease: var(--mz-ease-enter);");
    expect(css).toContain("--mz-ease-sheet: var(--mz-ease-expand);");
    expect(css).toContain("--mz-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);");
  });

  it("keeps the site's header and dock timings (SiteHeader 0.6s hide, 0.45s underline; glass 22px/1.6 and 18px/1.9)", () => {
    expect(T.motion.duration).toMatchObject({ moderate: 450, glide: 600, reveal: 900 });
    expect(T.glass).toMatchObject({ blurBar: 22, saturateBar: 1.6, blurDock: 18, saturateDock: 1.9, tintMix: 22 });
    expect(T.motion.press.scale).toBe(0.98);
  });

  it("emits every new group as CSS variables with units", () => {
    const css = read("dist/tokens.css");
    for (const line of [
      "--mz-duration-glide: 600ms;", "--mz-distance-reveal: 28px;", "--mz-stagger-list: 50ms;", "--mz-stagger-cap: 8;",
      "--mz-scroll-hide-after-down: 36px;", "--mz-scroll-resize-hold: 450ms;", "--mz-glass-blur-bar: 22px;",
      "--mz-glass-saturate-dock: 1.9;", "--mz-glass-tint-mix: 22;", "--mz-gutter-fluid: clamp(16px, 4vw, 64px);",
      "--mz-press-scale: 0.98;", "--mz-radius-pill: 9999px;", "--mz-dock-width: 420px;", "--mz-z-dock: 35;",
    ]) expect(css, line).toContain(line);
  });
});

describe("reduced motion", () => {
  const block = () => read("dist/tokens.css").split("@media (prefers-reduced-motion: reduce)")[1] ?? "";

  it("maps every duration, to at most 120ms, and stops the drift", () => {
    expect(keys(T.motion.reduced).sort()).toEqual(keys(T.motion.duration).sort());
    for (const k of keys(T.motion.reduced)) expect(T.motion.reduced[k], k).toBeLessThanOrEqual(120);
    expect(T.motion.reduced.drift).toBe(0);
  });

  it("the generated CSS overrides every duration and zeroes every distance and stagger delay", () => {
    const css = block();
    for (const k of keys(T.motion.duration)) expect(css, k).toContain(`--mz-duration-${k}: ${T.motion.reduced[k]}ms;`);
    for (const k of keys(T.motion.distance)) expect(css, k).toContain(`--mz-distance-${k}: 0px;`);
    expect(css).toContain("--mz-stagger-list: 0ms;");
    expect(css).not.toContain("--mz-stagger-cap");
  });

  it("Flutter gets the same reduced durations", () => {
    const dart = read("dist/mizan_tokens.dart");
    for (const k of keys(T.motion.reduced)) expect(dart, k).toContain(`static const reduced${k[0].toUpperCase()}${k.slice(1)} = Duration(milliseconds: ${T.motion.reduced[k]});`);
  });
});

describe("Tailwind entries", () => {
  const v4 = () => read("dist/tailwind.css");
  it.each([
    "--ease-spring:", "--ease-spring-soft:", "--ease-pour:", "--transition-duration-glide: var(--mz-duration-glide);",
    "--transition-duration-base: var(--mz-duration-base);", "--radius-pill:", "--radius-island-lg:", "--shadow-island:",
    "--text-display-hero:", "--text-kicker:", "--text-nav-link:", "--breakpoint-nav:", "--breakpoint-nav-full:", "--color-island-edge:",
  ])("v4 theme defines %s", (name) => expect(v4()).toContain(name));

  it("v3 preset has the same names", () => {
    const preset = read("dist/tailwind-preset.cjs");
    for (const n of ['"spring-soft"', '"glide"', '"island-lg"', '"nav-full"', '"island"']) expect(preset, n).toContain(n);
  });
});

describe("type steps", () => {
  it("Arabic drops the uppercase and the tracking of the kicker, and sets the hero in Alexandria", () => {
    const css = read("dist/tokens.css");
    expect(css).toMatch(/:lang\(ar\) \.mz-text-kicker, \.mz-text-kicker:lang\(ar\) \{ letter-spacing: 0;[^}]*text-transform: none;/);
    expect(css).toMatch(/:lang\(ar\) \.mz-text-display-hero, [^{]+\{ letter-spacing: 0;[^}]*font-family: var\(--mz-font-arabic-display\);/);
    expect(T.type.displayHero).toMatchObject({ weight: 800, tracking: -0.045 });
  });
});

describe("Geist 800 and 900", () => {
  const fonts = read("css/fonts.css");
  it.each([["Geist-ExtraBold.woff2", 800], ["Geist-Black.woff2", 900]])("%s is declared at %i and is a real woff2", (file, weight) => {
    expect(fonts).toContain(`url("../fonts/web/${file}") format("woff2"); font-weight: ${weight};`);
    const p = join(root, "fonts/web", file);
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p).subarray(0, 4).toString("latin1")).toBe("wOF2");
  });
  it("every weight token has a Geist face", () => {
    for (const w of Object.values(T.font.weight)) expect(fonts, String(w)).toMatch(new RegExp(`font-family: "Geist"; [^}]*font-weight: ${w};`));
  });
});

describe("ink island in the dark theme (current kit, not the rejected 2026-10 palette)", () => {
  it("the rim separates an ink island from the dark canvas", () => {
    // The island is ink (#0B0B0B) and so is the dark canvas: without a rim they merge (visual audit).
    expect(T.brand.ink.$value).toBe(dark("bg"));
    const rim = over(dark("islandEdge"), dark("bg"));
    expect(ratio(rim, hex(dark("bg")))).toBeGreaterThanOrEqual(1.15);
    // …but stays a hairline, quieter than a strong divider.
    expect(lum(rim)).toBeLessThan(lum(hex(dark("lineStrong"))));
  });
  it("the glow is visible but never brighter than a hovered surface", () => {
    const glow = over(dark("islandGlow"), dark("bg"));
    expect(lum(glow)).toBeGreaterThan(lum(hex(dark("bg"))));
    expect(lum(glow)).toBeLessThan(lum(hex(dark("surfaceHover"))));
  });
  it("the island shadow is declared per theme, so a nested data-theme gets its own rim", () => {
    const css = read("dist/tokens.css");
    expect(css.split("--mz-shadow-island:").length - 1).toBe(3);
    expect(css.split(":root {")[1].split("}")[0]).not.toContain("--mz-shadow-island");
  });
});

describe("kebab names", () => {
  it("every camelCase key reaches CSS in kebab case", () => {
    const css = read("dist/tokens.css");
    for (const k of keys(T.layout)) expect(css, k).toContain(`--mz-${kebab(k)}:`);
    for (const k of keys(T.motion.scroll)) expect(css, k).toContain(`--mz-scroll-${kebab(k)}:`);
  });
});
