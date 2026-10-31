import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = JSON.parse(readFileSync(join(root, "tokens/tokens.json"), "utf8"));
const val = (theme, k) => T.color[theme][k].$value;

// WCAG 2.x relative luminance and contrast
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** [foreground, background, minimum ratio] — 4.5 for text, 3 for large/UI graphics */
const PAIRS = [
  ["text", "bg", 4.5], ["text", "surface", 4.5], ["text", "surfaceHover", 4.5], ["text", "surfaceSunk", 4.5], ["text", "surfaceSelected", 4.5],
  ["text2", "surface", 4.5], ["text2", "bg", 4.5], ["text2", "surfaceSunk", 4.5],
  ["text3", "surface", 4.5], ["text3", "bg", 4.5],
  ["onPrimary", "primary", 4.5], ["onPrimary", "primaryHover", 4.5],
  ["onBrand", "brand", 4.5],
  ["brandText", "surface", 4.5], ["brandText", "brandSoft", 4.5],
  ["dangerText", "dangerSoft", 4.5], ["successText", "successSoft", 4.5], ["warningText", "warningSoft", 4.5], ["infoText", "infoSoft", 4.5], ["neutralText", "neutralSoft", 4.5],
  ["successText", "surface", 4.5], ["warningText", "surface", 4.5], ["infoText", "surface", 4.5],
  ["railText", "railBg", 4.5], ["railText2", "railBg", 4.5], ["railText", "railSurface", 4.5],
  ["focus", "surface", 3], ["focus", "bg", 3], ["lineStrong", "surface", 1.2], ["brand", "surface", 3], ["railActive", "railBg", 3],
];

describe.each(["light", "dark"])("%s theme", (theme) => {
  it.each(PAIRS)("%s on %s ≥ %s:1", (fg, bg, min) => {
    const r = contrast(val(theme, fg), val(theme, bg));
    expect(r, `${fg} ${val(theme, fg)} on ${bg} ${val(theme, bg)} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(min);
  });
  it("defines the same token names as the other theme", () => {
    const keys = (t) => Object.keys(T.color[t]).filter((k) => !k.startsWith("$")).sort();
    expect(keys(theme)).toEqual(keys(theme === "light" ? "dark" : "light"));
  });
});

describe("brand fidelity", () => {
  it("keeps Brandita's core colours exactly", () => {
    expect(T.brand.ink.$value).toBe("#0B0B0B");
    expect(T.brand.paper.$value).toBe("#FEF7FF");
    expect(T.brand.red.$value).toBe("#DE0000");
    expect(val("light", "bg")).toBe("#FEF7FF");
    expect(val("light", "brand")).toBe("#DE0000");
  });
  it("keeps the Brandita chart palette in its validated order", () => {
    expect(T.viz.light).toEqual(["#DE0000", "#2A78D6", "#EDA100", "#1BAF7A", "#4A3AA7", "#E87BA4"]);
    expect(T.viz.dark).toEqual(["#F5342E", "#3987E5", "#C98500", "#199E70", "#9085E9", "#D55181"]);
  });
  it("never uses red for the primary action (red is reserved for meaning)", () => {
    expect(val("light", "primary")).not.toBe(val("light", "brand"));
    expect(val("dark", "primary")).not.toBe(val("dark", "brand"));
  });
});

describe("CSS variable references", () => {
  it("every --mz-* variable used in css/ and the reference template is defined in dist/tokens.css", () => {
    const defined = new Set([...readFileSync(join(root, "dist/tokens.css"), "utf8").matchAll(/(--mz-[a-z0-9_-]+)\s*:/g)].map((m) => m[1]));
    const sources = ["css/base.css", "css/components.css", "reference/template.html"].map((f) => readFileSync(join(root, f), "utf8")).join("\n");
    const used = new Set([...sources.matchAll(/var\((--mz-[a-z0-9_-]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((v) => !defined.has(v));
    expect(missing).toEqual([]);
  });
});

describe("generated files", () => {
  it("are up to date with tokens.json", () => {
    const files = ["tokens.css", "tailwind.css", "tailwind-preset.cjs", "tokens.ts", "tokens.json", "mizan_tokens.dart"];
    const before = files.map((f) => readFileSync(join(root, "dist", f), "utf8"));
    execFileSync("node", [join(root, "scripts/build.mjs")]);
    const after = files.map((f) => readFileSync(join(root, "dist", f), "utf8"));
    expect(after).toEqual(before);
  });
  it("emit every colour token as a CSS variable in both themes", () => {
    const css = readFileSync(join(root, "dist/tokens.css"), "utf8");
    for (const k of Object.keys(T.color.light).filter((k) => !k.startsWith("$"))) {
      const name = `--mz-${k.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([a-z])([0-9])/g, "$1-$2").toLowerCase()}:`;
      expect(css.split(name).length - 1, name).toBeGreaterThanOrEqual(3); // light, dark, system-dark
    }
  });
});
