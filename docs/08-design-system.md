# 08 — Design system and UX

Visual reference: **`design/prototype.html`** (open in a browser; toggle AR/EN and light/dark). Build the web app to match it. Tokens below are copied from the prototype.

## 1. Principles

1. **Profit first.** Every screen answers "is this making money?" — the profit number is the first thing on the home screen.
2. **Arabic is not a translation.** Design in Arabic first, check English second. Egyptian Arabic for merchant UI copy ("أكد الأوردر", not formal MSA).
3. **Queues, not reports.** Ops screens show what needs action next, sorted by urgency.
4. **Mobile-first for ops.** Agents and warehouse staff work on phones; owners check profit on phones.
5. **One primary action per screen.** Clear CTA; secondary actions in menus.
6. **Calm and premium.** Neutral ink, one gold accent, generous spacing; colour only for status.

## 2. Tokens

### Colour — light

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#F1F2F4` | App background |
| `--surface` | `#FFFFFF` | Cards, tables |
| `--surface-2` | `#F7F8FA` | Hover, table header |
| `--sunk` | `#ECEEF1` | Inputs, wells |
| `--ink` | `#12151B` | Primary text |
| `--ink-2` | `#4B5261` | Secondary text |
| `--ink-3` | `#848B99` | Muted, placeholders |
| `--line` / `--line-2` | `#E2E5EA` / `#D3D7DE` | Borders |
| `--accent` | `#9C7320` | Brand gold, primary buttons |
| `--accent-ink` | `#7A5912` | Accent text on light |
| `--accent-soft` | `#F4ECDA` | Accent backgrounds |
| `--rail` / `--rail-2` | `#0E1116` / `#171B22` | Side navigation |
| `--good` / `--good-soft` | `#11795A` / `#E3F3EC` | Delivered, confirmed, profit |
| `--warn` / `--warn-soft` | `#A35F00` / `#FBF0DD` | Pending, medium risk |
| `--bad` / `--bad-soft` | `#BE3328` / `#FBE7E5` | Refused, high risk, loss |
| `--info` / `--info-soft` | `#2F5FB3` / `#E6EDF9` | In transit, info |

### Colour — dark

`--bg #0B0D11` · `--surface #13161C` · `--surface-2 #181C23` · `--sunk #0F1217` · `--ink #ECEEF2` · `--ink-2 #A8AEBA` · `--ink-3 #6E7583` · `--line #232731` · `--line-2 #2E3440` · `--accent #D6A94C` · `--accent-ink #E6BE6A` · `--accent-soft #2A2314` · `--good #3DBD8C` · `--warn #E3A43B` · `--bad #F06B5F` · `--info #7EA4EE` (soft variants in the prototype).

### Type

| Token | Stack | Use |
| --- | --- | --- |
| `--f-display` | Bricolage Grotesque, IBM Plex Sans Arabic | Headings, big numbers |
| `--f-body` | IBM Plex Sans, IBM Plex Sans Arabic | UI text |
| `--f-mono` | IBM Plex Mono | Order IDs, tracking numbers, amounts in tables |

Load fonts with `next/font` (self-hosted). Arabic text uses IBM Plex Sans Arabic for both display and body. Use tabular figures for numbers in tables.

### Shape and depth

`--r: 10px` (cards), `--r-sm: 6px` (inputs, pills). Shadow: `0 1px 2px rgba(16,20,28,.05), 0 8px 24px -12px rgba(16,20,28,.12)`.

### Tailwind mapping

Expose tokens as CSS variables in `globals.css` and map them in `tailwind.config` (`colors: { ink: 'var(--ink)', accent: 'var(--accent)', … }`). Dark mode with `class` strategy plus `prefers-color-scheme` default.

## 3. RTL and bilingual rules

- `<html lang="ar" dir="rtl">` / `lang="en" dir="ltr"`, switched per user preference (`users.language`).
- Use logical properties only: `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`. Lint rule: no `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-` in components.
- Icons that imply direction (arrows, chevrons, "back") flip in RTL; logos, checkmarks, media controls do not.
- Wrap numbers, phones, order IDs, tracking numbers, SKUs and URLs in `<bdi>` (or `dir="ltr"` span) inside Arabic text.
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
| Settings | Connections with health, team and roles, cost rules, billing |

## 5. Components

Build in `apps/web/src/components/ui` (shadcn/ui-style, owned code): Button, IconButton, Input, Select, Combobox, Checkbox, Switch, Tabs, Table (sortable, selectable, sticky header), Pill/Badge (status, risk), Card, StatCard (number + delta + sparkline), Drawer, Dialog, Toast, EmptyState, Skeleton, Timeline, MoneyText, PhoneText (masked, `<bdi>`), DateText, Avatar, CommandPalette.

## 6. Accessibility

WCAG 2.2 AA contrast for text and status pills in both themes; status never by colour alone (text label + icon); focus rings visible; all actions keyboard-reachable; tap targets ≥ 44 px in ops app.

## 7. Ops app (Flutter)

Same tokens (generate `lib/theme/tokens.dart` from the CSS variables). Material 3 with custom theme; `Directionality` from user language; `intl` + ARB files for strings. Offline-first: local SQLite (drift) queue of operations with `opId`; sync via `POST /v1/ops/sync`; conflict = server wins, user told.
