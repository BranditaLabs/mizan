# apps/web — Mizan dashboard

Next.js 16 (App Router) + Tailwind CSS 4, Arabic and English, right-to-left first-class.
Look and feel: `@mizan/design-system` (`packages/design-system`: tokens, fonts, icons, wordmark, component recipes). Layout reference: `design/prototype.html`. Rules: `docs/08-design-system.md`.

```
npm run dev -w @mizan/web      # http://localhost:3000 → /ar (needs `npm run build -w @mizan/shared` once)
npm run lint -w @mizan/web     # Next rules + Mizan bilingual rules
npm test -w @mizan/web         # unit: lint rule, AR/EN message parity, formatting, tokens
npm run build -w @mizan/web && npm run e2e -w @mizan/web   # Playwright smoke, both directions and themes
```

## Layout

| Path | What |
| --- | --- |
| `src/app/[locale]/` | Every page lives under `/ar` or `/en`; the layout sets `<html lang dir data-theme>` |
| `src/app/globals.css` | Imports the design system: `fonts.css` (self-hosted Geist, Alexandria, Plex Arabic, Geist Mono), `tokens.css`, `tailwind.css` (`bg-surface`, `text-text-2`, `bg-primary` …), `base.css` |
| `public/brand/`, `src/app/{favicon.ico,icon.svg,apple-icon.png,manifest.ts}` | Wordmarks and app icons from `packages/design-system/logo` |
| `src/i18n/` | next-intl routing (Arabic default, cookie `mizan-locale`), request config, locale-aware `Link`/router |
| `src/proxy.ts` | Locale negotiation: cookie → `Accept-Language` → Arabic |
| `messages/{ar,en}.json` | Every user-facing string, keyed by screen. Egyptian Arabic for merchant copy |
| `src/lib/format.ts` | Money (decimal strings, never floats), numbers, dates (Cairo), relative time; Western or Eastern Arabic digits |
| `src/lib/theme.ts` | Theme choice (`light` / `dark` / `system`), cookie `mizan-theme`, rendered by the server (no flash) |
| `src/components/` | `Shell` (ink rail with wordmark and icons, header), `Bdi` (isolate numbers and codes), `Segmented`, language and theme switches; icons via `<Icon name=…>` from the design system |
| `eslint-rules/no-physical-direction.js` | Blocks `ml-*`, `pr-*`, `left-*`, `text-right`, `border-l`, `rounded-tr` … with the logical fix in the message |

## Rules (lint-enforced)

- Logical directions only: `ms-/me-/ps-/pe-/start-/end-/text-start/border-s/rounded-s…` (`mizan/no-physical-direction`).
- No literal UI text in JSX: strings come from `messages/*.json` (`react/jsx-no-literals`); both files keep the same keys, arguments and tags (unit test).
- Order ids, phones, SKUs, tracking numbers: `<Bdi code>`; amounts: `formatMoney` inside `<Bdi>`.
- Only design system tokens for colour, type, radius, font and shadow (unit test `design-classes`); never hex values.
- Icons come from `@mizan/design-system/icons/react`; directional ones mirror in RTL by themselves.

The Cloud Run image builds with `NEXT_OUTPUT=standalone` (self-contained server); `next start` uses the default output.
