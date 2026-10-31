import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Components use only the design system's names (packages/design-system/dist/tailwind.css):
 * a renamed token (text-ink), an invented colour or a raw hex value fails here, not in review.
 */
const theme = readFileSync(new URL("../../../packages/design-system/dist/tailwind.css", import.meta.url), "utf8");
const defined = (kind: string) => new Set([...theme.matchAll(new RegExp(`--${kind}-([\\w-]+?):`, "g"))].map((m) => m[1]!).filter((n) => !n.includes("--")));
const COLORS = defined("color");
const RADII = defined("radius");
const TEXT = defined("text");
const FONTS = defined("font");
const SHADOWS = defined("shadow");

// Tailwind built-ins that carry no colour or brand decision.
const BUILTIN_COLORS = new Set(["white", "transparent", "current", "inherit"]);
const TEXT_LAYOUT = new Set(["start", "end", "center", "justify", "left", "right", "wrap", "nowrap", "balance", "pretty", "ellipsis", "clip"]);
const FONT_WEIGHTS = new Set(["thin", "light", "normal", "medium", "semibold", "bold", "extrabold"]);
const BORDER_WIDTHS = /^(\d+|[xysetblr]|[xysetblr]-\d+)$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith(".tsx") ? [join(dir, f)] : []));
}

/** Every class-like token inside string literals of the component files, variant prefixes removed. */
function classTokens(): Array<{ file: string; cls: string }> {
  const out: Array<{ file: string; cls: string }> = [];
  for (const file of files(fileURLToPath(new URL("../src", import.meta.url)))) {
    const src = readFileSync(file, "utf8");
    for (const lit of src.matchAll(/["`]([^"`]*)["`]/g)) {
      for (const raw of lit[1]!.split(/\s+/)) {
        const cls = raw.slice(raw.lastIndexOf(":") + 1).replace(/^!/, "");
        if (/^-?(bg|text|border|ring|fill|stroke|outline|rounded|font|shadow|from|to|via|decoration|divide|placeholder|accent|caret)(-|$)/.test(cls)) out.push({ file: file.replace(/.*apps\/web\//, ""), cls });
      }
    }
  }
  return out;
}

function allowed(cls: string): boolean {
  if (/#[0-9a-f]{3,8}\b|\[(#|rgb|hsl)/i.test(cls)) return false; // never raw colours
  const [, prefix, rest = ""] = /^-?(\w+)(?:-(.+))?$/.exec(cls)!;
  const name = rest.split("/")[0]!; // bg-bg/85 → bg
  if (!rest && !["border", "divide", "outline", "ring", "rounded", "shadow"].includes(prefix!)) return true; // a word like "to", not a class
  switch (prefix) {
    case "bg": case "fill": case "stroke": case "from": case "to": case "via": case "accent": case "caret": case "decoration": case "placeholder":
      return COLORS.has(name) || BUILTIN_COLORS.has(name);
    case "text": return COLORS.has(name) || BUILTIN_COLORS.has(name) || TEXT.has(name) || TEXT_LAYOUT.has(name);
    case "border": case "divide": case "outline": case "ring": {
      const side = name.replace(/^[xysetblr]-/, ""); // border-t-transparent: a side's colour
      return !rest || COLORS.has(side) || BUILTIN_COLORS.has(side) || BORDER_WIDTHS.test(rest) || ["solid", "dashed", "none"].includes(rest);
    }
    case "rounded": return !rest || RADII.has(rest.replace(/^(s|e|t|b|ss|se|es|ee)-/, "")) || ["s", "e", "t", "b"].includes(rest);
    case "font": return FONTS.has(name) || FONT_WEIGHTS.has(name);
    case "shadow": return SHADOWS.has(name) || name === "none";
    default: return true;
  }
}

describe("design system classes in apps/web", () => {
  it("reads the design system's names", () => {
    expect(COLORS.has("primary")).toBe(true);
    expect(TEXT.has("heading-lg")).toBe(true);
    expect(RADII.has("md")).toBe(true);
  });

  it("every colour, type, radius, font and shadow class is a design system token", () => {
    const tokens = classTokens();
    expect(tokens.length).toBeGreaterThan(30); // the scan really reads the components
    expect(tokens.filter(({ cls }) => !allowed(cls))).toEqual([]);
  });

  it("the guard catches the names this app used before the design system", () => {
    for (const old of ["text-ink-2", "bg-accent", "border-line-2", "rounded-card", "shadow-card", "bg-[#9C7320]", "font-body", "border-t-ink"]) expect(allowed(old), old).toBe(false);
  });
});
