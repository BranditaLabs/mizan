import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const block = (selector: string) => {
  const start = css.indexOf(selector);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
};
const defined = (body: string) => new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

describe("design tokens (docs/08 §2)", () => {
  const light = defined(block(":root {"));
  const darkSystem = defined(block(':root:not([data-theme="light"])'));
  const darkChosen = defined(block(':root[data-theme="dark"]'));
  const colours = [...light].filter((t) => !["--r", "--r-sm"].includes(t));

  it("every colour token has a dark value, in both the system and the chosen dark theme", () => {
    for (const t of colours) {
      expect(darkSystem.has(t), t).toBe(true);
      expect(darkChosen.has(t), t).toBe(true);
    }
    expect([...darkSystem].sort()).toEqual([...darkChosen].sort());
  });

  it("every Tailwind colour points at a defined token, and every colour token is exposed", () => {
    const theme = block("@theme inline");
    const mapped = [...theme.matchAll(/--color-([\w-]+):\s*var\((--[\w-]+)\)/g)];
    for (const [, name, ref] of mapped) {
      expect(light.has(ref!), `${name} → ${ref}`).toBe(true);
      expect(`--${name}`).toBe(ref);
    }
    const exposed = new Set(mapped.map((m) => m[2]));
    for (const t of colours.filter((x) => x !== "--shadow")) expect(exposed.has(t), t).toBe(true);
  });

  it("docs/08 values are the ones shipped", () => {
    expect(block(":root {")).toContain("--accent: #9C7320");
    expect(block(':root[data-theme="dark"]')).toContain("--accent: #D6A94C");
  });
});
