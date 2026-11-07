#!/usr/bin/env node
/**
 * Generates every platform file from tokens/tokens.json:
 *   dist/tokens.css          CSS custom properties (light, dark, system), type classes, Arabic adjustments
 *   dist/tailwind.css        Tailwind v4 @theme mapping (CSS-first config)
 *   dist/tailwind-preset.cjs Tailwind v3 preset (same names)
 *   dist/tokens.ts           Typed token object for TS/React
 *   dist/tokens.json         Flat resolved tokens (for tooling)
 *   dist/mizan_tokens.dart   Flutter colors, text styles, spacing, ThemeData builders
 * Run: npm run build -w @mizan/design-system   (CI checks the output is up to date)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = JSON.parse(readFileSync(join(root, "tokens/tokens.json"), "utf8"));
const out = (f, s) => { mkdirSync(join(root, "dist"), { recursive: true }); writeFileSync(join(root, "dist", f), s); };
const HEADER = "/* Generated from tokens/tokens.json by scripts/build.mjs. Do not edit. */\n";

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([a-z])([0-9])/g, "$1-$2").replace(/\./g, "_").toLowerCase();
const v = (o) => (o && typeof o === "object" && "$value" in o ? o.$value : o);
const entries = (o) => Object.entries(o).filter(([k]) => !k.startsWith("$"));
/** Plain-number groups ({ "$units": { key: unit, "*": default } }) as [key, "value+unit"]. */
const withUnits = (group) => {
  const u = group.$units ?? {};
  return entries(group).map(([k, n]) => [k, `${n}${k in u ? u[k] : (u["*"] ?? "")}`]);
};
/** "cubic-bezier(a, b, c, d)" → [a, b, c, d] */
const bezier = (s) => s.match(/-?[\d.]+/g).map(Number);
const M = T.motion;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const rgbTriplet = (c) => {
  if (c.startsWith("rgba")) return null;
  const h = c.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" ");
};

// ───────────── CSS ─────────────
function colorVars(theme) {
  return entries(T.color[theme]).map(([k, o]) => {
    const val = v(o); const t = rgbTriplet(val);
    return `  --mz-${kebab(k)}: ${val};` + (t ? `\n  --mz-${kebab(k)}-rgb: ${t};` : "");
  }).join("\n") + themedShadows();
}
// A shadow that reads theme colours is declared with each theme, so a nested data-theme resolves its own colours.
const isThemed = (s) => s.includes("var(");
const themedShadows = () => entries(T.shadow).filter(([, s]) => isThemed(s)).map(([k, s]) => `\n  --mz-shadow-${k}: ${s};`).join("");
const vizVars = (theme) => T.viz[theme].map((c, i) => `  --mz-viz-${i + 1}: ${c};`).join("\n");
// Which one-colour partner logo face shows (css/components.css .mz-partner): set with each theme, so
// the nearest data-theme wins and a light island inside a dark page shows the light file.
const partnerFaceVars = (theme) => `  --mz-partner-face-light: ${theme === "light" ? "inline-flex" : "none"};\n  --mz-partner-face-dark: ${theme === "light" ? "none" : "inline-flex"};`;

const staticVars = [
  ...entries(T.brand).map(([k, o]) => `  --mz-brand-${kebab(k)}: ${v(o)};`),
  ...entries(T.font.family).map(([k, o]) => `  --mz-font-${kebab(k)}: ${v(o)};`),
  ...entries(T.font.weight).map(([k, n]) => `  --mz-weight-${k}: ${n};`),
  ...entries(T.space).map(([k, n]) => `  --mz-space-${k.replace(".", "_")}: ${n}px;`),
  ...entries(T.radius).map(([k, n]) => `  --mz-radius-${kebab(k)}: ${n}px;`),
  ...entries(T.border).map(([k, n]) => `  --mz-border-${k}: ${n}px;`),
  ...entries(T.shadow).filter(([, s]) => !isThemed(s)).map(([k, s]) => `  --mz-shadow-${k}: ${s};`),
  ...entries(M.duration).map(([k, n]) => `  --mz-duration-${k}: ${n}ms;`),
  ...entries(M.easing).map(([k, s]) => `  --mz-ease-${kebab(k)}: ${s};`),
  ...entries(M.easingAlias).map(([k, to]) => `  --mz-ease${k === "default" ? "" : `-${kebab(k)}`}: var(--mz-ease-${kebab(to)});`),
  `  --mz-press-scale: ${M.press.scale};`,
  ...withUnits(M.distance).map(([k, s]) => `  --mz-distance-${kebab(k)}: ${s};`),
  ...withUnits(M.stagger).map(([k, s]) => `  --mz-stagger-${kebab(k)}: ${s};`),
  ...withUnits(M.scroll).map(([k, s]) => `  --mz-scroll-${kebab(k)}: ${s};`),
  ...withUnits(T.glass).map(([k, s]) => `  --mz-glass-${kebab(k)}: ${s};`),
  ...entries(T.fluid).map(([k, s]) => `  --mz-${kebab(k)}-fluid: ${s};`),
  ...entries(T.size.control).map(([k, n]) => `  --mz-control-${k}: ${n}px;`),
  ...entries(T.size.icon).map(([k, n]) => `  --mz-icon-${k}: ${n}px;`),
  `  --mz-icon-stroke: ${T.size.iconStroke};`,
  ...entries(T.layout).map(([k, n]) => `  --mz-${kebab(k)}: ${n}px;`),
  ...entries(T.z).map(([k, n]) => `  --mz-z-${k}: ${n};`),
].join("\n");

const typeClasses = entries(T.type).map(([k, t]) => {
  const fam = `var(--mz-font-${kebab(t.family)})`;
  return `.mz-text-${kebab(k)} { font-family: ${fam}; font-size: ${t.size}px; line-height: ${t.lineHeight}px; font-weight: ${t.weight}; letter-spacing: ${t.tracking}em;${t.transform ? ` text-transform: ${t.transform};` : ""}${t.numeric ? ` font-variant-numeric: ${t.numeric};` : ""} }
:lang(ar) .mz-text-${kebab(k)}, .mz-text-${kebab(k)}:lang(ar) { letter-spacing: 0; line-height: ${Math.round(t.lineHeight * 1.15)}px;${t.transform ? " text-transform: none;" : ""}${t.family === "display" ? " font-family: var(--mz-font-arabic-display);" : ""} }`;
}).join("\n");

out("tokens.css", `${HEADER}
:root {
${staticVars}
}

/* Light theme (default) */
:root, [data-theme="light"] {
  color-scheme: light;
${colorVars("light")}
${vizVars("light")}
${partnerFaceVars("light")}
}

/* Dark theme: explicit */
[data-theme="dark"] {
  color-scheme: dark;
${colorVars("dark")}
${vizVars("dark")}
${partnerFaceVars("dark")}
}

/* Dark theme: follow the system unless the user chose light */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${colorVars("dark").replace(/^/gm, "  ")}
${vizVars("dark").replace(/^/gm, "  ")}
${partnerFaceVars("dark").replace(/^/gm, "  ")}
  }
}

/* Type styles */
${typeClasses}

/* Arabic: never negative tracking; body copy in IBM Plex Sans Arabic */
:lang(ar) { letter-spacing: 0; }

/* Numbers, IDs and codes stay left-to-right inside Arabic text */
.mz-ltr, bdi.mz-num { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }

/* Reduced motion: short fades instead of movement (tokens.json motion.reduced) */
@media (prefers-reduced-motion: reduce) {
  :root {
${entries(M.reduced).map(([k, n]) => `    --mz-duration-${k}: ${n}ms;`).join("\n")}
${entries(M.distance).map(([k]) => `    --mz-distance-${kebab(k)}: 0px;`).join("\n")}
${withUnits(M.stagger).filter(([, s]) => s.endsWith("ms")).map(([k]) => `    --mz-stagger-${kebab(k)}: 0ms;`).join("\n")}
  }
}
`);

// ───────────── Tailwind v4 (@theme) ─────────────
const twColors = entries(T.color.light).map(([k]) => `  --color-${kebab(k)}: var(--mz-${kebab(k)});`).join("\n");
const twViz = T.viz.light.map((_, i) => `  --color-viz-${i + 1}: var(--mz-viz-${i + 1});`).join("\n");
out("tailwind.css", `${HEADER}/* Tailwind v4: @import "tailwindcss"; @import "@mizan/design-system/dist/tokens.css"; @import "@mizan/design-system/dist/tailwind.css"; */
@theme inline {
${twColors}
${twViz}
  --font-sans: var(--mz-font-sans);
  --font-display: var(--mz-font-display);
  --font-mono: var(--mz-font-mono);
${entries(T.radius).map(([k, n]) => `  --radius-${kebab(k)}: ${n}px;`).join("\n")}
${entries(T.shadow).filter(([k]) => k !== "none").map(([k]) => `  --shadow-${k}: var(--mz-shadow-${k});`).join("\n")}
${entries(T.type).map(([k, t]) => `  --text-${kebab(k)}: ${t.size}px;\n  --text-${kebab(k)}--line-height: ${t.lineHeight}px;\n  --text-${kebab(k)}--letter-spacing: ${t.tracking}em;\n  --text-${kebab(k)}--font-weight: ${t.weight};`).join("\n")}
${entries(M.easing).map(([k, s]) => `  --ease-${kebab(k)}: ${s};`).join("\n")}
${entries(M.duration).map(([k]) => `  --transition-duration-${k}: var(--mz-duration-${k});`).join("\n")}
${entries(T.breakpoint).map(([k, n]) => `  --breakpoint-${kebab(k)}: ${n / 16}rem;`).join("\n")}
}
`);

// ───────────── Tailwind v3 preset ─────────────
const v3colors = Object.fromEntries(entries(T.color.light).map(([k, o]) =>
  [kebab(k), rgbTriplet(v(o)) ? `rgb(var(--mz-${kebab(k)}-rgb) / <alpha-value>)` : `var(--mz-${kebab(k)})`]));
T.viz.light.forEach((_, i) => { v3colors[`viz-${i + 1}`] = `var(--mz-viz-${i + 1})`; });
const v3 = {
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    // Tailwind v3 writes min-width queries in object order, so they must ascend (v4 sorts by value).
    // Set on theme, not extend: extending would append nav and nav-full after the default 2xl.
    screens: Object.fromEntries(entries(T.breakpoint).sort(([, a], [, b]) => a - b).map(([k, n]) => [kebab(k), `${n}px`])),
    extend: {
      colors: v3colors,
      fontFamily: { sans: ["var(--mz-font-sans)"], display: ["var(--mz-font-display)"], mono: ["var(--mz-font-mono)"] },
      fontSize: Object.fromEntries(entries(T.type).map(([k, t]) => [kebab(k), [`${t.size}px`, { lineHeight: `${t.lineHeight}px`, letterSpacing: `${t.tracking}em`, fontWeight: String(t.weight) }]])),
      borderRadius: Object.fromEntries(entries(T.radius).map(([k, n]) => [kebab(k), `${n}px`])),
      boxShadow: { ...Object.fromEntries(entries(T.shadow).filter(([k]) => k !== "none").map(([k]) => [k, `var(--mz-shadow-${k})`])), none: "none" },
      transitionTimingFunction: Object.fromEntries(entries(M.easing).map(([k, s]) => [kebab(k), s])),
      transitionDuration: Object.fromEntries(entries(M.duration).map(([k]) => [k, `var(--mz-duration-${k})`])),
      zIndex: Object.fromEntries(entries(T.z).map(([k, n]) => [k, String(n)])),
    },
  },
};
out("tailwind-preset.cjs", `${HEADER}/** Tailwind v3 preset: presets: [require("@mizan/design-system/dist/tailwind-preset.cjs")] */\nmodule.exports = ${JSON.stringify(v3, null, 2)};\n`);

// ───────────── Flat JSON + TS ─────────────
const flat = {
  brand: Object.fromEntries(entries(T.brand).map(([k, o]) => [k, v(o)])),
  color: { light: Object.fromEntries(entries(T.color.light).map(([k, o]) => [k, v(o)])), dark: Object.fromEntries(entries(T.color.dark).map(([k, o]) => [k, v(o)])) },
  viz: { light: T.viz.light, dark: T.viz.dark },
  font: { family: Object.fromEntries(entries(T.font.family).map(([k, o]) => [k, v(o)])), weight: T.font.weight },
  type: Object.fromEntries(entries(T.type).map(([k, t]) => [k, Object.fromEntries(entries(t))])),
  space: Object.fromEntries(entries(T.space)),
  radius: Object.fromEntries(entries(T.radius)),
  border: T.border,
  shadow: Object.fromEntries(entries(T.shadow)),
  motion: {
    duration: M.duration, easing: M.easing,
    easingAlias: Object.fromEntries(entries(M.easingAlias)),
    reduced: Object.fromEntries(entries(M.reduced)),
    pressScale: M.press.scale,
    distance: Object.fromEntries(entries(M.distance)),
    stagger: Object.fromEntries(entries(M.stagger)),
    scroll: Object.fromEntries(entries(M.scroll)),
  },
  glass: Object.fromEntries(entries(T.glass)),
  fluid: Object.fromEntries(entries(T.fluid)),
  size: T.size, layout: T.layout, breakpoint: T.breakpoint, z: T.z,
};
out("tokens.json", JSON.stringify(flat, null, 2) + "\n");
out("tokens.ts", `${HEADER}export const tokens = ${JSON.stringify(flat, null, 2)} as const;\n\nexport type ColorToken = keyof typeof tokens.color.light;\nexport type TypeToken = keyof typeof tokens.type;\nexport type Theme = "light" | "dark";\n\n/** CSS variable reference for a colour token, e.g. cssVar("brand") → "var(--mz-brand)". */\nexport const cssVar = (t: ColorToken) => \`var(--mz-\${t.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([a-z])([0-9])/g, "$1-$2").toLowerCase()})\`;\n`);

// ───────────── Flutter ─────────────
const dartColor = (c) => {
  if (c.startsWith("rgba")) {
    const [r, g, b, a] = c.match(/[\d.]+/g).map(Number);
    return `Color.fromRGBO(${r}, ${g}, ${b}, ${a})`;
  }
  return `Color(0xFF${c.replace("#", "").toUpperCase()})`;
};
const dartColors = (theme) => entries(T.color[theme]).map(([k, o]) => `  static const ${k} = ${dartColor(v(o))};`).join("\n");
const dartType = entries(T.type).map(([k, t]) => {
  const fam = t.family === "mono" ? "GeistMono" : "Geist";
  const fb = t.family === "display" ? "'Alexandria'" : t.family === "mono" ? "" : "'IBMPlexSansArabic'";
  return `  static const ${k} = TextStyle(fontFamily: '${fam}', fontFamilyFallback: [${fb}], fontSize: ${t.size}, height: ${(t.lineHeight / t.size).toFixed(3)}, fontWeight: FontWeight.w${t.weight}, letterSpacing: ${(t.tracking * t.size).toFixed(2)}${t.numeric ? ", fontFeatures: [FontFeature.tabularFigures()]" : ""});`;
}).join("\n");
out("mizan_tokens.dart", `// Generated from tokens/tokens.json by scripts/build.mjs. Do not edit.
// Fonts: add packages/design-system/fonts/ttf/* to pubspec.yaml under families Geist, GeistMono, Alexandria, IBMPlexSansArabic.
import 'dart:ui' show FontFeature;
import 'package:flutter/material.dart';

class MizanBrand {
${entries(T.brand).map(([k, o]) => `  static const ${k} = ${dartColor(v(o))};`).join("\n")}
}

class MizanColorsLight {
${dartColors("light")}
}

class MizanColorsDark {
${dartColors("dark")}
}

class MizanViz {
  static const light = [${T.viz.light.map(dartColor).join(", ")}];
  static const dark = [${T.viz.dark.map(dartColor).join(", ")}];
}

class MizanType {
${dartType}
}

class MizanSpace {
${entries(T.space).map(([k, n]) => `  static const double s${k.replace(".", "_")} = ${n};`).join("\n")}
}

class MizanRadius {
${entries(T.radius).map(([k, n]) => `  static const double ${k} = ${n};`).join("\n")}
}

class MizanMotion {
${entries(M.duration).map(([k, n]) => `  static const ${k} = Duration(milliseconds: ${n});`).join("\n")}
${entries(M.easing).map(([k, s]) => `  static const ${k} = Cubic(${bezier(s).join(", ")});`).join("\n")}
  static const pressScale = ${M.press.scale};
${entries(M.distance).map(([k, n]) => `  static const double distance${cap(k)} = ${n};`).join("\n")}
${withUnits(M.stagger).map(([k, s]) => s.endsWith("ms")
    ? `  static const stagger${cap(k)} = Duration(milliseconds: ${M.stagger[k]});`
    : `  static const int stagger${cap(k)} = ${M.stagger[k]};`).join("\n")}

  // With reduced motion (MediaQuery.disableAnimations): short fades, no travel.
${entries(M.reduced).map(([k, n]) => `  static const reduced${cap(k)} = Duration(milliseconds: ${n});`).join("\n")}
${entries(M.distance).map(([k]) => `  static const double reducedDistance${cap(k)} = 0;`).join("\n")}
${withUnits(M.stagger).filter(([, s]) => s.endsWith("ms")).map(([k]) => `  static const reducedStagger${cap(k)} = Duration.zero;`).join("\n")}
}

ThemeData _mizanTheme(Brightness b) {
  final light = b == Brightness.light;
  final bg = light ? MizanColorsLight.bg : MizanColorsDark.bg;
  final surface = light ? MizanColorsLight.surface : MizanColorsDark.surface;
  final text = light ? MizanColorsLight.text : MizanColorsDark.text;
  final text2 = light ? MizanColorsLight.text2 : MizanColorsDark.text2;
  final primary = light ? MizanColorsLight.primary : MizanColorsDark.primary;
  final onPrimary = light ? MizanColorsLight.onPrimary : MizanColorsDark.onPrimary;
  final brand = light ? MizanColorsLight.brand : MizanColorsDark.brand;
  final line = light ? MizanColorsLight.line : MizanColorsDark.line;
  final lineStrong = light ? MizanColorsLight.lineStrong : MizanColorsDark.lineStrong;
  final danger = light ? MizanColorsLight.dangerText : MizanColorsDark.dangerText;
  return ThemeData(
    useMaterial3: true,
    brightness: b,
    scaffoldBackgroundColor: bg,
    fontFamily: 'Geist',
    fontFamilyFallback: const ['IBMPlexSansArabic'],
    colorScheme: ColorScheme(
      brightness: b, primary: primary, onPrimary: onPrimary, secondary: brand, onSecondary: Colors.white,
      error: danger, onError: Colors.white, surface: surface, onSurface: text, outline: lineStrong, outlineVariant: line,
    ),
    dividerTheme: DividerThemeData(color: line, thickness: 1, space: 1),
    cardTheme: CardThemeData(color: surface, elevation: 0, margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(MizanRadius.md), side: BorderSide(color: line))),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(
      backgroundColor: primary, foregroundColor: onPrimary, minimumSize: const Size(0, 44), elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(MizanRadius.sm)), textStyle: MizanType.label)),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(
      foregroundColor: text, minimumSize: const Size(0, 44), side: BorderSide(color: lineStrong),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(MizanRadius.sm)), textStyle: MizanType.label)),
    inputDecorationTheme: InputDecorationTheme(
      filled: true, fillColor: surface, hintStyle: MizanType.body.copyWith(color: text2),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(MizanRadius.sm), borderSide: BorderSide(color: lineStrong)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(MizanRadius.sm), borderSide: BorderSide(color: lineStrong)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(MizanRadius.sm), borderSide: BorderSide(color: text, width: 2)),
    ),
    appBarTheme: AppBarTheme(backgroundColor: bg, foregroundColor: text, elevation: 0, scrolledUnderElevation: 0, titleTextStyle: MizanType.headingSm.copyWith(color: text)),
  );
}

final mizanLightTheme = _mizanTheme(Brightness.light);
final mizanDarkTheme = _mizanTheme(Brightness.dark);
`);

console.log("design tokens built → dist/");
