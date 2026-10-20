# 08 — Design system and UX

**Source of truth: `packages/design-system`** (`@mizan/design-system`, adopted Oct 2026). Brandita's identity — ink, paper and one red point — as tokens for the web (CSS variables, Tailwind 4), TypeScript and Flutter, plus fonts, 124 icons, the wordmark and app icons. Open `packages/design-system/reference/index.html` to see everything in light/dark and AR/EN; component recipes and UX rules are in `packages/design-system/docs/components.md`; the brand book is `Mizan-Design-System.pdf` there.

`design/prototype.html` remains the reference for **screen layouts and flows** only; its brass-gold palette and Bricolage/Plex fonts are superseded.

## 1. Principles

1. **Profit first.** Every screen answers "is this making money?" — the profit number is the first thing on the home screen.
2. **One system, one navigation.** All 22 modules live in one rail (Home, Orders, Confirmation, Payments, Shipping, Warehouse, Purchasing, Returns, Inbox, Customers, Channels, POS, Profit, Finance, Attribution, Reports, Automations, Settings); modules a plan does not include show an upgrade state, never a dead link.
3. **Arabic is not a translation.** Design in Arabic first, check English second. Egyptian Arabic for merchant UI copy ("أكد الأوردر", not formal MSA).
4. **Queues, not reports.** Ops screens show what needs action next, sorted by urgency.
5. **Mobile-first for ops.** Agents and warehouse staff work on phones; owners check profit on phones.
6. **One primary action per screen.** Clear CTA; secondary actions in menus.
7. **Calm and premium.** Ink on paper, generous spacing, flat surfaces; colour only for status. **Red is a scalpel:** the logo's point, the active navigation indicator, the one number that matters, and errors. **Primary actions are ink, never red.**

## 2. Tokens, type and shape

Defined in `packages/design-system/tokens/tokens.json`; never copy values into apps. Change a token there, run `npm run build -w @mizan/design-system`, and its tests check WCAG AA contrast in both themes, brand fidelity and that generated files are current.

| Topic | Rule | Where |
| --- | --- | --- |
| Colour | Brand ink `#0B0B0B`, paper `#FEF7FF`, red `#DE0000` (red-hi `#E33232` on dark), lines `#EDEDED` / `#D9D9D9`. Components use semantic names only: `bg`, `surface(-hover/-sunk/-selected)`, `line(-strong)`, `text(-2/-3/-disabled)`, `primary` / `on-primary`, `brand(-soft/-text)`, `success/warning/danger/info(-soft/-text)`, `rail-*`, `viz-1…6` for charts | `dist/tokens.css` (`--mz-*`), `dist/tailwind.css` (`bg-surface`, `text-text-2` …) |
| Themes | Light default; `<html data-theme="dark">`, or the system preference when no theme is chosen | `dist/tokens.css` |
| Type | Geist (Latin UI and display), Alexandria (Arabic display, Arabic wordmark), IBM Plex Sans Arabic (Arabic body), Geist Mono (IDs, tracking numbers, SKUs). Scale: `display-*`, `heading-lg/md/sm`, `body(-lg/-sm)`, `label`, `caption`, `overline`, `kpi(-sm)`, `mono` | `css/fonts.css`, `dist/tailwind.css` |
| Shape | Radius `xs 4 · sm 6 · md 8 · lg 12 · xl 16`. **Flat:** no shadows on cards, buttons or shapes; only menus, dialogs and toasts use `shadow-overlay` | tokens |
| Motion | Only transform and opacity; `ease-enter` 200 ms in, `ease-exit` 150 ms out; gentler under reduced motion | `css/base.css` |
| Icons | `<Icon name="cod" />` (meaningful names, 18 px, stroke 1.75); directional icons mirror in RTL automatically | `icons/react.tsx`, `icons/manifest.json` |
| Logo | Type only, outlined; the dots of **i** and **ن** are red. Never live type, recolour, rotate or move the red point. `*-on-dark.svg` on ink surfaces | `logo/` |

**In `apps/web` (✅ E4-1b):** `globals.css` imports the package's `fonts.css`, `tokens.css`, `tailwind.css` and `base.css` (in the base layer); the shell uses its wordmark, icons and favicons; a unit test fails on any colour, type, radius, font or shadow class that is not a design system token (or a raw hex value).

## 3. RTL and bilingual rules

- `<html lang="ar" dir="rtl">` / `lang="en" dir="ltr"`, switched per user preference (`users.language`).
- Use logical properties only: `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`. Lint rule: no `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-` in components.
- Icons that imply direction (arrows, chevrons, "back") flip in RTL (`.mz-rtl-flip`, set by `<Icon>` from the manifest's `rtlFlip`); logos, checkmarks, media controls do not.
- Wrap numbers, phones, order IDs, tracking numbers, SKUs and URLs in `<bdi>` inside Arabic text: in `apps/web`, `<Bdi code>` (Geist Mono, `dir="ltr"`, `mz-id`) for codes and `<Bdi>` (`mz-num`, tabular) for amounts; `base.css` isolates `.mz-num` / `.mz-id` / `.mz-mono` left to right in RTL.
- Digits: Western digits (0–9) by default in both languages (merchants and couriers use them); allow Eastern Arabic digits as a tenant setting. Parsing must accept both (`٠١٠٠…` → `0100…`; engine already normalizes phones).
- Currency: `EGP 1,150` in English; `١٬١٥٠ ج.م` or `1,150 ج.م` in Arabic per digit setting. Use `Intl.NumberFormat` with the tenant locale.
- Dates: `Intl.DateTimeFormat`; relative times ("منذ 6 دقائق") in queues.
- Strings: next-intl message files `messages/ar.json`, `messages/en.json`; keys by screen (`orders.list.title`). No string literals in components (lint).

## 4. Core layouts (from the prototype)

| Screen | Key elements |
| --- | --- |
| Home (profit) | Net profit yesterday / 30 days, margin, RTO rate, cash in transit, top leaks; profit by product |
| Orders | Status filter chips with counts, table (order, customer masked, store, total, risk pill, status, age), bulk bar |
| Order detail | Timeline, customer and address with map pin, lines, risk reasons, confirmation attempts, shipment, P&L breakdown |
| Confirmation queue | One order at a time, script panel, click-to-call / WhatsApp, outcome buttons, next order |
| Shipping | Ready to ship, courier picker with scorecard, label print, tracking list |
| Warehouse (ops app) | Pick list, scan screen (big feedback: green ✓ / red ✗ + vibration), offline banner |
| Automation Studio | Recipe gallery; When → If → Then builder (V2 canvas) |
| Script Builder | Blocks list, live WhatsApp preview with real order data, dialect switch, A/B setup |
| Payments | Ledger per order, payment links, refunds, disputes, payment mix |
| Reconciliation | Expected vs paid by source (courier, gateway, BNPL, marketplace, bank), gaps, claims |
| Purchasing | Reorder suggestions, POs, receiving, landed cost |
| Inbox | Conversation list with SLA, thread with the order panel, saved replies, AI drafts |
| Channels | Listings per marketplace, errors, buffers, payouts |
| Finance | Business P&L, expenses, VAT, period close, exports |
| Reports | Built-in dashboards, report builder, schedules |
| Settings | Connections with health, team and roles, cost rules, developer keys and webhooks, billing |

**Implemented (✅ E4-1, `apps/web`):** `<html lang dir data-theme>` per locale and theme cookie; lint rule `mizan/no-physical-direction` (physical class → its logical fix) and `react/jsx-no-literals`; AR/EN message parity test; `<Bdi code>` lays codes out left to right (`#1042`, not `1042#`, inside Arabic — checked by measuring glyph positions in the smoke test).

## 5. Components

Recipes and rules: `packages/design-system/docs/components.md` (buttons, fields, status and payment badges, tables, KPI tiles, feedback, floating layers, copy). Build them in `apps/web/src/components/ui` (owned code, reproducing the recipes exactly): Button, IconButton, Input, Select, Combobox, Checkbox, Switch, Tabs, Table (sortable, selectable, sticky header), Pill/Badge (status, risk), Card, StatCard (number + delta + sparkline), Drawer, Dialog, Toast, EmptyState, Skeleton, Timeline, MoneyText, PhoneText (masked, `<bdi>`), DateText, Avatar, CommandPalette.

## 6. Accessibility

WCAG 2.2 AA contrast for text and status pills in both themes; status never by colour alone (text label + icon); focus rings visible; all actions keyboard-reachable; tap targets ≥ 44 px in ops app.

## 7. Ops app (Flutter)

Same tokens: `packages/design-system/dist/mizan_tokens.dart` (`mizanLightTheme`, `mizanDarkTheme`, colours, type, spacing, radius, motion) and the TTF fonts in `packages/design-system/fonts/ttf` (pubspec in its README). Material 3 with custom theme; `Directionality` from user language; `intl` + ARB files for strings. Offline-first: local SQLite (drift) queue of operations with `opId`; sync via `POST /v1/ops/sync`; conflict = server wins, user told.
