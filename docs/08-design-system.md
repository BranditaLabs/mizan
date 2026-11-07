# 08 — Design system and UX

**Source of truth: `packages/design-system`** (`@mizan/design-system`, adopted Oct 2026). Brandita's identity — ink, paper and one red point — as tokens for the web (CSS variables, Tailwind 4), TypeScript and Flutter, plus fonts, 124 icons, the Brand 2.0 marks (two-ball mark, EN/AR wordmarks, lockup, bilingual mark, app icons) and the motion system (§2a). Open `packages/design-system/reference/index.html` to see everything in light/dark and AR/EN; component recipes and UX rules are in `packages/design-system/docs/components.md`; the brand book is `Mizan-Design-System.pdf` there.

`design/prototype.html` remains the reference for **screen layouts and flows** only; its brass-gold palette and Bricolage/Plex fonts are superseded.

## 1. Principles

1. **Profit first.** Every screen answers "is this making money?" — the profit number is the first thing on the home screen.
2. **One system, one navigation.** All 22 modules live in one rail (Home, Orders, Confirmation, Payments, Shipping, Warehouse, Purchasing, Returns, Inbox, Customers, Channels, POS, Profit, Finance, Attribution, Reports, Automations, Settings); modules a plan does not include show an upgrade state, never a dead link.
3. **Arabic is not a translation.** Design in Arabic first, check English second. Egyptian Arabic for merchant UI copy ("أكد الأوردر", not formal MSA).
4. **Queues, not reports.** Ops screens show what needs action next, sorted by urgency.
5. **Mobile-first for ops.** Agents and warehouse staff work on phones; owners check profit on phones.
6. **One primary action per screen.** Clear CTA; secondary actions in menus.
7. **Calm and premium.** Ink on paper, generous spacing, flat surfaces; colour only for status. **Red is a scalpel, once per view:** the mark's right ball, the active navigation indicator, the one number that matters, and errors. **Primary actions are ink, never red.**

## 2. Tokens, type and shape

Defined in `packages/design-system/tokens/tokens.json`; never copy values into apps. Change a token there, run `npm run build -w @mizan/design-system`, and its tests check WCAG AA contrast in both themes, brand fidelity and that generated files are current.

| Topic | Rule | Where |
| --- | --- | --- |
| Colour | Brand ink `#0B0B0B`, paper `#FEF7FF`, red `#DE0000` (red-hi `#E33232` on dark), lines `#EDEDED` / `#D9D9D9`. Components use semantic names only: `bg`, `surface(-hover/-sunk/-selected)`, `line(-strong)`, `text(-2/-3/-disabled)`, `primary` / `on-primary`, `brand(-soft/-text)`, `success/warning/danger/info(-soft/-text)`, `rail-*`, `viz-1…6` for charts | `dist/tokens.css` (`--mz-*`), `dist/tailwind.css` (`bg-surface`, `text-text-2` …) |
| Themes | Light default; `<html data-theme="dark">`, or the system preference when no theme is chosen | `dist/tokens.css` |
| Type | Geist (Latin UI and display), Alexandria (Arabic display, Arabic wordmark), IBM Plex Sans Arabic (Arabic body), Geist Mono (IDs, tracking numbers, SKUs). Scale: `display-*`, `heading-lg/md/sm`, `body(-lg/-sm)`, `label`, `caption`, `overline`, `kpi(-sm)`, `mono` | `css/fonts.css`, `dist/tailwind.css` |
| Shape | Radius `xs 4 · sm 6 · md 8 · lg 12 · xl 16`, `pill` for the top bar, dock and chips, `island 20 · island-lg 28` for ink islands only. **Flat:** no shadows on cards, buttons or shapes; only menus, dialogs and toasts use `shadow-overlay` | tokens |
| Motion | Only transform and opacity; `ease-enter` 200 ms in, `ease-exit` 150 ms out. Brandita's site motion (docs/16 §2.3): `--mz-ease` (= enter), `--mz-ease-spring`, `--mz-ease-sheet` (= expand), `moderate 450 · glide 600 · reveal 900 · drift 24000` ms, press `scale(0.98)`, distance, stagger and scroll thresholds. **Brand 2.0 event motion: §2a.** Reduced motion: every duration ≤120 ms (drift, tip, fall, ripple and roll 0), distances and stagger 0 (CSS and the Dart `reduced*` constants) | `tokens.json` `motion`, `css/base.css`, `css/motion.css` |
| Icons | `<Icon name="cod" />` (meaningful names, 18 px, stroke 1.75); directional icons mirror in RTL automatically | `icons/react.tsx`, `icons/manifest.json` |
| Logo (Brand 2.0) | **The mark is two fluid balls, ink on the left and red on the right, like the pans of a scale.** Only the right ball is red, and it moves only in DROP. Never recolour, rotate, separate or animate the mark outside the four motion rules; never live type. Files: `mizan-mark`, `mizan-wordmark` (EN), `mizan-wordmark-ar`, `mizan-lockup`, `mizan-bilingual`, each plain (on paper), `-on-ink` (red on ink `#E33232`), `-mono-ink` and `-mono-paper` (no red: the app chrome, so the content owns the view's red); `mizan-appicon`, `mizan-appicon-paper`, `mizan-appicon-red`, `mizan-favicon`. PNGs, `favicon.ico`, the web apple-icon and the ops launcher icons and splash are generated from the SVGs (`npm run build:png -w @mizan/design-system`) and checked by `test/logo.test.mjs` | `logo/svg`, `logo/png`, `logo/animated` |
| Partner logos | Real marks only (simple-icons paths at a pinned version, or press-kit files), never recoloured, cropped or animated; colour on a light neutral tile; the brand's own black/white file only where its guide allows; a monogram tile otherwise, before someone has read the brand's guide (`guideCheckedAt`), while the guide's written permission is pending (`permission: "required"`, e.g. Shopify), or below the guide's minimum size; monograms distinct within a kind; mono shows the colour mark on its tile on hover and focus (D8, off under reduced motion); the one-colour face follows the nearest `data-theme`, so light islands in a dark page stay readable; ids outside the manifest take a localized `label` (docs/16 §5.9) | `logos/partners/`, `<PartnerLogo>` |

**In `apps/web` (✅ E4-1b):** `globals.css` imports the package's `fonts.css`, `tokens.css`, `tailwind.css` and `base.css` (in the base layer); the shell uses its wordmark, icons and favicons; a unit test fails on any colour, type, radius, font or shadow class that is not a design system token (or a raw hex value).

## 2a. Motion (Brand 2.0, BR-1)

The pack ("Mizan Brand 2.0", Nov 2026; `mizan-brand-2.0.zip` SHA-256 `03c40adb8e06944d1660b4f510ea57d6b94e55d5ea89ac45056d7cd3b68f7c0d`) gives the brand four motion rules. Every animation in the web app, the back office and the ops app is one of them, picked by **the event**, never by the screen.

| Rule | What moves | Tokens | Used for |
| --- | --- | --- | --- |
| **TIP** | The two sides compare by rising and falling (±18°, loop 2.6 s); an off-balance badge holds 8° | `duration.tip`, `angle.tip`, `angle.tipHold` | the pair loader; `tip` and `fail` outcomes (something needs a look) |
| **MERGE** | Agreeing values flow into one; the neck forms in 380 ms, nothing snaps | `duration.merge`, `goo.*` | `merge` and `done` outcomes; the transfer loader's balance |
| **SETTLE** | Arrive with a small overshoot and a damped wobble | `duration.settle` 720 ms, `easing.settle` `cubic-bezier(.34,1.32,.5,1)`, `duration.roll`, `spring.*` | `settle` outcome, toasts, KPI roll, instruments |
| **DROP** | The red enters from above **once**, only when something is confirmed | `duration.fall` 620 ms, `duration.ripple` 1.4 s | `drop` outcome (an allowlist: order confirmed, payment paid, …); the drop loader |

**Loaders by meaning.** A screen names what the press does, never an animation; the loader is derived from it (`ACTIONS` and `LOADER_FOR` in `packages/shared/src/motion`), so nothing can fall back to the save animation:

| Loader | Meaning | Wait meanings (`as=`, `busyAs=`, `Waiting meaning=`) |
| --- | --- | --- |
| `pair` | read, wait for an answer: a page or data loading, signing in, checking a code, searching, a download being prepared | `loading`, `signingIn`, `checking` |
| `transfer` | sync two systems, or send something out: an SMS code, an email link, a push to Shopify/WooCommerce/the courier/Meta, an upload, an OAuth hand-off | `syncing`, `sending` |
| `drop` | a write in Mizan: save, create, confirm, delete, a payment link (red only on the DROP allowlist, only when confirmed) | `saving`, `creating` |
| `fill` | known progress with a **real value** (done of total), never indeterminate | none: only `FillProgress`/`FillBar` with `done`/`total`, or `MizanLoader kind="fill"` with `value` |

A confirmed outcome (signed in, two-step on) is `DoneState`. Busy controls take `busy` with `as` (or a `useEventMutation` result whose event has an action); a bare `busy` is a type error and fails `mizan/busy-needs-meaning`. Rows in a list key busy by `mutation.variables`, and a screen with several controls keeps one busy key so only the pressed one animates. `level` is gallery-only. Instruments (`Gauge`, `Vessels`, `Breakeven`, `Bullseye`) compare two values; one instrument per view.

**Red once per view.** The red ball is the view's single red point: the shell uses the mono marks, so the content owns it; auth, splash, boot and outage use the full-colour mark as their one red. A `RedBudget` at the layout root grants it to one claimant at a time (a DROP outranks a loader); a refused claimant renders mono. Money going out never gets red. Danger text and badges are not budgeted (D5).

**Reduced motion** (`prefers-reduced-motion`; Flutter `MediaQuery.disableAnimations`): a deliberate still frame, never a slower loop. Pair is level and apart (the mark), transfer balanced with no droplets, drop resting on a flat surface, fill at its width with the percentage as text, glyphs at their end frame. No rAF or ticker runs; every reduced duration is ≤120 ms.

**Where it lives:**
- `packages/design-system/motion` (pure TS: one rAF clock with IntersectionObserver and hidden-tab pause, reduced store, physics per loader and instrument, red budget, scheduler, Intl figures) and `react/motion` (`MizanLoader`, `EventGlyph`, `DoneState`, `Mark`, `Wordmark`, `Lockup`, `RedBudget`, lazy instruments). `css/motion.css` holds the keyframes and the one reduced-motion block.
- `packages/shared/src/motion`: the catalogue: `EVENT_MOTION` (every domain event), `TIMELINE_MOTION`, `ENGINE_MOTION`, `motionFor`. The per-event table is generated into `docs/13` §2.1.
- Web and admin: `EventMotionProvider` (catalogue → scheduler → surfaces) and the primitives `Button` busy, `PageState`, `FillProgress`, `toast.event`, bell rows, timeline rows, `SyncPill`, `BootLoader`; lint rules `mizan/no-adhoc-motion` and `mizan/no-brand-red`.
- Ops app (Flutter): `lib/motion` (§7).

**Committed from the pack:** the logo SVGs, the 8 animated SMIL SVGs (`logo/animated`, no-JS fallbacks only) and the pair, transfer and drop Lottie files, minified, in `apps/ops/assets/lottie`. **Not committed** (kept in Brandita's brand drive, named with their SHA-256 in `logo/MANIFEST.json`): the videos (`.mp4`, `.webm`, `.mov`), the GIFs, the 1200 px PNGs, the fill Lottie (the ops app paints fill live), the brand page and the two component scripts (ported by hand into `motion/`, never run). `scripts/asset-budget.mjs` fails the package tests on any video or GIF under `apps/` or `packages/`, or an oversized file.

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

Recipes and rules: `packages/design-system/docs/components.md` (buttons, fields, status and payment badges, tables, KPI tiles, feedback, floating layers, copy). **✅ E4-3:** built in `apps/web/src/components/ui` as React wrappers over the package's `components.css` classes (imported in the components layer, so the reference page and the app cannot drift); see them all at `/ar/ui` and `/en/ui`. Dialogs and drawers use the native modal `<dialog>`; keyboard movement in tabs, segmented controls and menus follows the screen in right-to-left. The list from the plan: Button, IconButton, Input, Select, Combobox, Checkbox, Switch, Tabs, Table (sortable, selectable, sticky header), Pill/Badge (status, risk), Card, StatCard (number + delta + sparkline), Drawer, Dialog, Toast, EmptyState, Skeleton, Timeline, MoneyText, PhoneText (masked, `<bdi>`), DateText, Avatar, CommandPalette.

## 5b. Mizan Glass (the web app's surface, Oct 2026)

The design team's premium layer, `packages/design-system/css/glass.css` (guide: `packages/design-system/docs/glass.md`), renders ink, paper and red as light through frosted glass. It ships as delivered and stays untouched; `css/glass-bridge.css` maps the core tokens (`--mz-*`) and components (`.mz-card`, `.mz-btn`, fields, tables, menus, dialogs, toasts, badges, skeletons) onto it inside a `.mzg` root, so every screen built on the core classes and Tailwind tokens becomes Glass without being rewritten.

- `GlassRoot` (`apps/web/src/components/GlassRoot.tsx`) wraps the app frame and the auth screens: theme (`.light` follows the person's choice or the system), direction, and the drifting light fields.
- The rail uses Glass navigation (`.nav`, `.nav-ind` sliding on a spring with the red point, `.nav-item`); the rail and top bar are `.g` panels.
- Ink islands (`<GlassRoot ink>`): the dashboard hero and the sign-in brand side stay dark glass in either theme.
- New code may use the Glass classes directly (`.g`, `.g-2`, `.chip`, `.seg`); prefer the UI kit components, which carry the bridge. Glass's own `.ld-*` loaders are not used: every loader is a Brand 2.0 `MizanLoader` picked by event (§2a); `mizan/no-adhoc-motion` blocks the rest.
- The customer-facing confirmation page (`/c/[token]`) stays on the plain core system (low-end phones, no blur).

## 6. Accessibility

WCAG 2.2 AA contrast for text and status pills in both themes; status never by colour alone (text label + icon); focus rings visible; all actions keyboard-reachable; tap targets ≥ 44 px in ops app.

## 7. Ops app (Flutter)

Same tokens: `packages/design-system/dist/mizan_tokens.dart` (`mizanLightTheme`, `mizanDarkTheme`, colours, type, spacing, radius, motion) and the TTF fonts in `packages/design-system/fonts/ttf` (pubspec in its README). Material 3 with custom theme; `Directionality` from user language; `intl` + ARB files for strings. Offline-first: local SQLite (drift) queue of operations with `opId`; sync via `POST /v1/ops/sync`; conflict = server wins, user told. ✅ E8-4a in `apps/ops` (the theme and fonts are copied there; a test keeps them current).

**Brand 2.0 in the ops app (✅ BR-1, the ops part of BR-3):** launcher icons from `mizan-appicon` (Android mipmaps, the iOS AppIcon set). The native splash is the mark centred on paper (on ink at night on Android: `values-night/colors.xml`, `drawable-night-*/splash_mark.png`); the first Flutter frame shows the pair loader until the phone's database opens (`OpsBoot`). `lib/motion` holds the motion: `EventLoader` / `MizanLoader` play the pack's on-paper Lottie files (`lottie` 3.6.1; on ink a colour matrix recolours them to the on-ink pair, which keeps `assets/lottie` under its 1.2 MB budget; the still frame shows until the JSON is parsed, and queue rows use the still frame only) picked by event, so refresh is pair and sync is transfer; `FillBar` is known progress (scanned of wanted, packed of a list); `VesselsCount` shows ordered against received on each receiving line; `EventGlyph` plays each scan (counted settles, a blocked item tips and holds, with the heavy buzz); `showEventSnack` turns a saved count, a packed box and a received delivery into toasts for `stock.adjusted`, `order.packed` and `stock.received`, with a light tap. Durations and springs come from `MizanMotion` only. The phone's own work (booting, loading, syncing, a scan) is in `opsEventMotion`, next to the generated `event_motion.g.dart`. Hidden tabs pause their tickers (`TickerMode`); under `MediaQuery.disableAnimations` every widget shows its still frame. `test/motion_test.dart` holds the goldens, the catalogue checks and the ban on `CircularProgressIndicator` and `LinearProgressIndicator` in `lib/`.
