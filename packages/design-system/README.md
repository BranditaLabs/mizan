# @mizan/design-system

Mizan's design system, built on Brandita's identity: **ink, paper and one red point**. One source of tokens for the web app (CSS, Tailwind), TypeScript and the Flutter ops app, plus the wordmark, app icons, 124 icons and the fonts.

Open **`reference/index.html`** in a browser to see everything: logo, colour, type, icons, components and a full orders screen, in light and dark, Arabic and English.

```
npm test  -w @mizan/design-system    # 70 tests: WCAG contrast in both themes, brand fidelity, generated files up to date, no undefined CSS variables
npm run build -w @mizan/design-system  # regenerate dist/, icons and the reference page after editing tokens.json or icons/manifest.json
```

## What's inside

| Path | What it is |
| --- | --- |
| `tokens/tokens.json` | **The source of truth.** Brand colours, semantic colours (light + dark), data colours, type scale, spacing, radius, motion, sizes, layout, z-index |
| `dist/tokens.css` | CSS variables `--mz-*` for light, dark (`[data-theme="dark"]`) and system dark; `.mz-text-*` type classes with Arabic adjustments |
| `dist/tailwind.css` | Tailwind v4 `@theme` mapping (`bg-surface`, `text-text-2`, `font-display`, `text-kpi`, `ease-enter` …) |
| `dist/tailwind-preset.cjs` | The same for Tailwind v3 |
| `dist/tokens.ts` | Typed token object (charts, inline styles, tests) |
| `dist/mizan_tokens.dart` | Flutter: `MizanColorsLight/Dark`, `MizanType`, `MizanSpace`, `MizanRadius`, `MizanMotion`, `mizanLightTheme`, `mizanDarkTheme` |
| `css/fonts.css` · `css/base.css` · `css/components.css` | Font faces, base layer (focus, RTL, selection, reduced motion), reference components `mz-*` |
| `icons/` | `manifest.json` (source), `svg/*.svg`, `sprite.svg`, `index.ts` (names, labels, RTL flags), `react.tsx` (`<Icon name="cod" />`) |
| `logo/` | `svg/` wordmarks and lockups, `png/` app icons and favicons, `favicon.ico`, `source/` scripts that outline the type |
| `fonts/` | `web/*.woff2`, `ttf/*.ttf` (Flutter), `licenses/` (all SIL OFL 1.1) |
| `reference/` | `template.html` + generated self-contained `index.html` |
| `docs/components.md` | Component catalogue with Tailwind recipes and UX rules |

## Brand in one minute

- **Colours:** ink `#0B0B0B`, paper `#FEF7FF`, red `#DE0000` (red-hi `#E33232` on dark). Lines `#EDEDED` / `#D9D9D9`. These are Brandita's, unchanged.
- **Red is a scalpel.** It marks the logo's red point, the active navigation indicator, the one number that matters, and errors. **Primary actions are ink, never red.** A screen with red in four places has three too many.
- **Flat.** No shadows on cards, buttons or shapes. Only floating layers (menus, dialogs, toasts) use `--mz-shadow-overlay`.
- **Type:** Geist (Latin UI and display), Geist Mono (IDs, tracking numbers, SKUs), Alexandria (Arabic display and the Arabic wordmark), IBM Plex Sans Arabic (Arabic body). All open-source (OFL).
- **Logo:** type only. *mizan* in Geist Bold, *ميزان* in Alexandria Bold, outlined to paths. The dot of the **i** and the dot of the **ن** are red. Never set it in live type, recolour it, outline it, rotate it, add effects, or move the red point.

## Use in the Next.js web app (`apps/web`)

```ts
// app/fonts.ts — self-hosted, no layout shift
import localFont from "next/font/local";
const ds = "../../packages/design-system/fonts/web";
export const geist = localFont({ src: [
  { path: `${ds}/Geist-Regular.woff2`, weight: "400" }, { path: `${ds}/Geist-Medium.woff2`, weight: "500" },
  { path: `${ds}/Geist-SemiBold.woff2`, weight: "600" }, { path: `${ds}/Geist-Bold.woff2`, weight: "700" } ], variable: "--font-geist", display: "swap" });
// …same for GeistMono, Alexandria (500–800), IBMPlexSansArabic (400–700)
```

```css
/* app/globals.css (Tailwind v4) */
@import "tailwindcss";
@import "@mizan/design-system/tokens.css";
@import "@mizan/design-system/tailwind.css";
@import "@mizan/design-system/base.css";
/* optional: the reference component classes */
@import "@mizan/design-system/components.css";
```

```tsx
// app/layout.tsx
<html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} data-theme={theme /* "light" | "dark" | undefined for system */}>
```

Then use semantic Tailwind classes: `bg-bg`, `bg-surface`, `border-line`, `text-text`, `text-text-2`, `bg-primary text-on-primary`, `text-brand-text`, `bg-success-soft text-success-text`, `font-display text-kpi`, `rounded-md`, `ease-enter`. Never hex values in components.

### Icons

```tsx
import { Icon } from "@mizan/design-system/icons/react";   // needs lucide-react in apps/web
<Icon name="cod" />                    // 18 px, stroke 1.75, decorative
<Icon name="refund" label="Refund" />  // labelled for screen readers
<Icon name="back" />                   // directional icons mirror automatically in RTL
```

Names describe meaning (`orders`, `verification`, `cod`, `bnpl`, `refund`, `courier`, `refused` …), never the glyph. To add one: add a row to `icons/manifest.json` (name, Lucide glyph, group, EN/AR labels, `rtlFlip`), run the build.

### Logo

Use `<img src="/brand/mizan-wordmark.svg" alt="mizan">` (copy `logo/svg` to `apps/web/public/brand`). On ink surfaces and in dark mode use `*-on-dark.svg`. Favicon set: `logo/favicon.ico`, `logo/svg/mizan-favicon.svg`, `logo/png/mizan-appicon-180.png` (apple-touch-icon), `-192` and `-512` (manifest).

## Use in Flutter (`apps/ops`)

```yaml
# pubspec.yaml
flutter:
  fonts:
    - family: Geist
      fonts: [{asset: fonts/Geist-Regular.ttf, weight: 400}, {asset: fonts/Geist-Medium.ttf, weight: 500}, {asset: fonts/Geist-SemiBold.ttf, weight: 600}, {asset: fonts/Geist-Bold.ttf, weight: 700}]
    - family: GeistMono
      fonts: [{asset: fonts/GeistMono-Regular.ttf, weight: 400}, {asset: fonts/GeistMono-Medium.ttf, weight: 500}, {asset: fonts/GeistMono-SemiBold.ttf, weight: 600}]
    - family: Alexandria
      fonts: [{asset: fonts/Alexandria-Medium.ttf, weight: 500}, {asset: fonts/Alexandria-SemiBold.ttf, weight: 600}, {asset: fonts/Alexandria-Bold.ttf, weight: 700}, {asset: fonts/Alexandria-ExtraBold.ttf, weight: 800}]
    - family: IBMPlexSansArabic
      fonts: [{asset: fonts/IBMPlexSansArabic-Regular.ttf, weight: 400}, {asset: fonts/IBMPlexSansArabic-Medium.ttf, weight: 500}, {asset: fonts/IBMPlexSansArabic-SemiBold.ttf, weight: 600}, {asset: fonts/IBMPlexSansArabic-Bold.ttf, weight: 700}]
```

```dart
import 'mizan_tokens.dart'; // copy dist/mizan_tokens.dart into lib/theme/
MaterialApp(theme: mizanLightTheme, darkTheme: mizanDarkTheme, themeMode: ThemeMode.system);
```

Icons in Flutter: render `icons/svg/*.svg` with `flutter_svg` (colour via `ColorFilter`), or use the `lucide_icons` package with the glyph names in `icons/manifest.json`.

## Changing the system

1. Edit `tokens/tokens.json` (or `icons/manifest.json`).
2. `npm run build -w @mizan/design-system`.
3. `npm test -w @mizan/design-system`. Contrast tests fail if any text/background pair drops below WCAG AA in either theme.
4. Commit the source and the generated files together (CI fails if they differ).

Licences: fonts SIL OFL 1.1 (`fonts/licenses`); icon glyphs from Lucide, ISC (`icons/LUCIDE-LICENSE.txt`). Wordmark and app icons © Brandita.
