# Mizan redesign plan (master)

Status: **revision 2** for the owner, 2026-11-06 (revised after a completeness critique; accepted and rejected points are listed in Appendix A, "Critique decisions"). This plan drives all implementation of the redesign. It is built on nine read-only audit reports: brandita-site, web-shell, screens-ops, screens-insight, integrations-onboarding, billing, admin-events, landing and visual (staging screenshots).

**Go-live coupling.** This plan runs alongside `docs/15-go-live-plan.md` (L0 staging, L1 harden, L2 production week 4, L3 pilots 1–3 weeks 5–6, L4 pilots 4–10 weeks 7–9, Gate 2). Launch tasks win every day; from week 5, 30% of engineering stays on pilot fixes. Rollout rules are in §11.0b: every visible change for pilot stores ships behind an A-6 per-store flag.

The plan covers:
- the app (`apps/web`), the back office and customer-service panel (`apps/admin`, every page, not only the new ones), the ops app (`apps/ops`, Flutter), the landing page, the design system (`packages/design-system`), and the API, worker, DB and infrastructure work that the new screens need;
- the owner's asks: Brandita nav and motion, an integration map, locked channel data, real logos, every device, animated onboarding, a 7-day trial and subscriptions, an admin/CS event centre with recovery, and a new landing page.

**Hands-off zone.** Two branches are rebuilding the WhatsApp confirmation settings: `claude/e6-16b-confirmation-studio*` and `claude/e6-16d-template-choice*`. While they are open, nothing in this plan edits these:
- `components/settings/ConfirmationSettingsScreen.tsx`, `ScriptEditor.tsx`, `ConfirmationResults.tsx`, `AfterConfirmationScreen.tsx`, `OffersSettingsScreen.tsx`
- `components/studio/*`, `components/confirmation/*`
- `apps/api/src/modules/confirmation/*`, `whatsapp-chat.service.ts`
- the `confirmationSettings`, `afterConfirmation` and `offersSettings` message namespaces
- the UI-kit files those screens import (`ConfirmationSettingsScreen.tsx:8-12` imports `@/components/ui/{Alert,Badge,Button,SaveBar,Choice}`): their paths and exports must keep working, so the kit extraction leaves re-export shims (§2.5)

Work that depends on them is marked **[WAITS: Studio]** or **[WAITS: Template]**. Three interfaces are agreed with the branch owners now, so later work never forks their code: `WhatsAppPhone` `readOnly` + `transcript` props, a style-agnostic `WhatsAppPhone` core usable without Tailwind/next-intl (for the landing), and a `StudioSummary` export (read-only summary of the chosen flow, template and status, with section anchors for deep links).

> **Owner answers (2026-11-06), these override the defaults below:**
> - **D1 palette: keep Mizan's current kit** (`paper #FEF7FF`, `ink #0B0B0B`, red `#DE0000`). §2.1's palette table is **not** applied. DS-1 keeps only the new non-colour tokens (motion, type steps, Geist 800/900, island edge/glow for dark computed from the current kit). Only the Brandita nav, its structure and its animations come from the site. OP-1 shrinks to whatever token additions DS-1 makes.
> - **D2 fonts: keep Geist / IBM Plex Sans Arabic / Alexandria** (as recommended).
> - **D3 trial end: drop to a limited Free plan** (orders keep flowing, paid screens become locked previews for 30 days; Free not sold publicly) (as recommended).
> - **D17 navigation: Brandita top bar everywhere, bottom dock on phones, optional 64px icon rail at ≥1280 per user** (as recommended).
> - Every other decision (D4–D16, D18–D21) proceeds on its recommended default until the owner changes it.

Notation:
- **Default:** a product default the owner can change, usually from admin.
- **[CONFIRM]:** a fact to check before building.
- File paths are relative to the repo root unless they start with `components/` or `lib/`, which mean `apps/web/src/...`.

---

## 1. Principles

1. **One Brandita identity.** Ink, a warm light canvas and **one red point**. Red means "act here" or "this is broken", never decoration. The app, the back office, the landing page and the ops app share tokens from `@mizan/design-system`. There are no second palettes and no per-app copies of components.
2. **Arabic first, English equal.** Arabic is the default locale and is designed first. English is checked on every screen.
   - Logical CSS only (`*-inline-*`, `inset-inline`, `--mz-dir`, `--mz-o`).
   - Numbers, phones, order ids, dates and Latin names go in `<bdi>` with the right `dir`.
   - Egyptian Arabic for merchant copy.
   - Dates, months, times and percents always go through `Intl`. Native `mm/dd/yyyy` inputs are banned.
   - **Digits: Western (`latn`) everywhere, in both languages**, the same rule the landing test already enforces. Arabic-Indic input is accepted and normalized. All Arabic examples in this plan use Western digits.
   - **Money: one `formatMoney(amount, currency, locale)`** in `@mizan/shared` (code prefix style, e.g. "EGP 749.95" / "749.95 ج.م" per locale rule, never mixing "US$" and "$"), with a unit test; FX-1 replaces every ad-hoc format.
3. **Next action first.** Every screen answers "what do I do now" above the fold: one primary action, queues as chips with counts, and detail on demand (drawer, tab, sheet). Status is a picture (pipeline, health node, countdown), not a sentence.
4. **Every device is a first-class layout.** Each screen is specified at phone (<768), tablet (768–1279) and desktop (≥1280), plus the input-mode rules in §3.2 (landscape phones, coarse pointers at any width, the on-screen keyboard).
   - No page ever scrolls sideways; this is enforced by an e2e contract.
   - Tap targets are at least 44px on touch (`pointer:coarse`, at any width) and at least 24px with a mouse.
   - Inputs are at least 16px on phones. Use `100dvh` and safe areas.
   - Nothing is reachable by hover only: hover reveals are also shown on focus and are always visible under `(pointer:coarse)` (touch laptops, iPads with a keyboard).
5. **Motion has a job.** Motion only shows a cause (where something came from), a state change (sync, error, saved), continuity (list → detail) or a direct-manipulation response (drag, press). Rules:
   - Animate transform and opacity only. Colour changes (row flash) use an opacity fade on a `::after` overlay, never `background-color`. The single stated exception: a row leaving a list may collapse with `grid-template-rows: 1fr → 0fr` for one row at a time (§4.0).
   - Motion that depends on experimental or partly supported APIs (`<ViewTransition>`, top-layer exit with `overlay`, scroll-driven animations) is **progressive**: a crossfade or instant fallback elsewhere, and never an acceptance criterion.
   - No animation loops off-screen or in hidden tabs.
   - Entrances never hide LCP content.
6. **Reduced motion is a full design, not a switch.** Under `prefers-reduced-motion: reduce`:
   - no particles, pulses, shakes, springs, parallax or cursor effects;
   - fades of 120ms or less;
   - static arrows and text replace flow animations, and state is still fully readable.
7. **Accessibility.**
   - WCAG 2.2 AA in both themes (contrast is tested in `packages/design-system/test`).
   - Status is never shown by colour alone: always icon + text.
   - Visible focus ring: 2px monochrome, keeping Mizan's rule that red is reserved for meaning.
   - Real landmarks; tabs and segmented controls with RTL-aware arrow keys; `aria-live` only for state changes, throttled.
   - Every visual-only surface (map, pipeline, charts) has a text or table equivalent.
8. **Truth on screen.**
   - No number that looks final while its inputs are missing. Missing costs mean "provisional profit".
   - Example data is labelled as such.
   - Channel-owned data is locked and shows where it comes from.
   - Errors are in merchant language with a fix button.
9. **Performance budgets.**

| Surface | Budget |
|---|---|
| App, cold load on a mid-range Android over 4G | Frame painted at ≤1.2s; first useful data at ≤2.5s p75 |
| App INP | ≤200ms (target 150) |
| App CLS | ≤0.05 |
| App JS per route (after the shared frame) | ≤150KB gz; heavy screens (reports charts, Studio, map) load with `next/dynamic` |
| i18n payload per route | Only that route's namespaces (today all 247KB of `ar.json` ships everywhere) |
| Lists | Paginate or virtualize past 100 rows; never render 50+ heavy rows on first paint |
| Animation | `backdrop-filter` only on the bar, the dock and an open sheet (cards are solid tinted surfaces on `(pointer:coarse)` and under `prefers-reduced-transparency`; blur 12px on coarse pointers); integration map particles ≤6 per lane and ≤60 total on fine pointers, **≤2 per lane and ≤20 total on `(pointer:coarse)`**; all paused when hidden or off-screen |
| Landing (`apps/site`) | LCP ≤1.8s p75, CLS ≤0.03, INP ≤150ms, **JS ≤140KB gz total including the Next/React runtime, islands ≤45KB**; cursor, reveal director and scroll-spy written as vanilla `<script type="module">` outside React; CSS ≤30KB gz, fonts ≤2 preloaded files per locale (≤110KB), no animation libraries |
| Live counters | Badge and LiveLine rolls at most once per 2s per badge; counts held in `useHeaderState` with bail-out setters so a delta never re-renders the shell |
| CI | Lighthouse CI on the landing (perf ≥95, a11y 100, SEO 100); route bundle-size check on web; the responsive contract e2e (§11 FX-1); the flow-budget e2e (principle 11) |

10. **No new animation libraries.** CSS, Web Animations API, IntersectionObserver and scroll-driven animations as progressive enhancement. React `<ViewTransition>` (experimental in React 19.x / Next 16 `experimental.viewTransition`) is progressive only. Sonner is allowed for toasts if chosen (§2.4).
11. **Every job has a flow budget.** "Best UX" is measured as interactions per job, enforced by a Playwright flow-budget test that counts clicks/taps/keys on the main path (fails when a change adds a step):

| Job | Budget |
|---|---|
| Confirm an order from the orders list | ≤2 taps (row action or swipe + confirm) |
| One confirmation call, start to logged outcome | ≤3 actions (Call, outcome, optional reason chip; auto-advance) |
| Ship 30 ready orders with one courier | ≤4 actions (queue chip, select group, Book, confirm) |
| Fix a failed booking | ≤3 actions without leaving the Fix queue |
| Add a missing product cost | ≤2 actions per row (type, Enter) + one Save for the batch |
| Approve a refund | ≤2 actions from the approval queue |
| Open any integration's settings | 1 click/tap on its map node (2 on touch: card, then drawer; or long press) |
| Replay a dead job (merchant) | ≤3 actions from the node's Problems tab |
| Start a trial from the landing to the first screen | ≤3 screens (sign-up, verify, onboarding step 1) |

---

## 2. Design system changes (`packages/design-system`)

**Identity update (Nov 2026): Brand 2.0.** The palette and fonts stay (§2.1, §2.2); the mark becomes two fluid balls (ink left, red right, like scale pans) and the brand gains four motion rules. How that reaches every event: §2.6.

### 2.1 Palette (owner decision D1: **keep the current Mizan kit**; the table below is the rejected alternative, kept for the record)

The site uses the designer's 2026-10 exports. Mizan still uses the older PDF kit (lavender paper). **Default:** move Mizan to the 2026-10 palette so the site and the app read as one brand.

| Token (`tokens.json`) | Today | New |
|---|---|---|
| `brand.ink` | `#0B0B0B` | `#131313` (plus `ink2 #1B1B1B`, `ink3 #222222`) |
| `brand.bone` (light canvas) | `paper #FEF7FF` | `#F5F4F1` |
| `brand.paper` (sunk light surface) | — | `#EEEDED` (plus `paper2 #E4E3E2`) |
| `brand.red` (fills, the one red point) | `#DE0000` | `#D63233` (white on it ≈4.8:1, passes AA) |
| `brand.redText` (red text on light) | `#B00000` | `#B0262A` (`#D63233` on bone is ≈4.4:1 and fails AA for small text) |
| dark-theme red | `#EA4643` / `#E33232` | `#E5484A`, to be checked by the contrast test on `#131313` |
| on-ink mute / rule | — | `#A3A29F` / `#2A2A2A` |
| on-paper mute / rule | — | `#545454` / `#D9D8D6` |
| glass light canvas (`glass.css .mzg.light`) | `#F5EFF7` | `#F5F4F1` |
| ink-island edge (dark theme) | — | new `surface.islandEdge` (a 1px `rgba(255,255,255,.08)` rim plus a soft inner glow token `surface.islandGlow`), so the hero ink island no longer merges into the `#131313` dark background (visual audit) |

Ripple work:
- `DESIGN.md`, the README "Brand in one minute", `glass.css` theme variables (through `glass-bridge.css`), the generated Flutter `mizan_tokens.dart`, the `logo/svg` fills and the PNG app icons (`scripts/build-png.mjs`).
- Re-run all 70 design-system tests and update the brand-fidelity fixtures.
- The ops app: regenerate `apps/ops/lib/theme/mizan_tokens.dart` and update `apps/ops/test/design_system_copy_test.dart` in the same PR (OP-1), so the Flutter suite never goes red on main.

### 2.2 Fonts (default = keep the product fonts)

- **App, admin and ops:** keep Geist, Geist Mono, IBM Plex Sans Arabic (body 400–700) and Alexandria (display). Dense UI needs Plex 400/500, which Cairo's shipped 600–900 subset lacks, and the wordmark is outlined Geist and Alexandria.
- **Add `Geist-ExtraBold` (800) and `Geist-Black` (900) woff2** (OFL) to `fonts/web` and `css/fonts.css`. This gives Brandita's display voice (800, −0.045em, line height .95) without Inter. Alexandria 800 already ships.
- An exact Inter + Cairo match on the landing is only an option (owner decision D2). It is not recommended.

### 2.3 New tokens (`tokens/tokens.json`)

`scripts/build.mjs:40-53` emits every key generically. Three changes are needed in the build script:
- extend the reduced-motion block at `build.mjs:99-100` with the new duration names;
- add emitters for the new groups (`distance`, `stagger`, `scroll`, `glass`) to CSS, TS and Dart;
- add Tailwind theme entries at `build.mjs:105-115` (`ease-spring`, `duration-glide`, `rounded-pill`, etc.) so `apps/web/test/design-classes.test.ts` accepts them.

```json
"motion": {
  "duration": { "instant": 80, "fast": 150, "base": 200, "slow": 300,
                "moderate": 450, "glide": 600, "reveal": 900, "drift": 24000 },
  "easing": {
    "enter":      "cubic-bezier(0.23, 1, 0.32, 1)",
    "expand":     "cubic-bezier(0.32, 0.72, 0, 1)",
    "exit":       "(keep current)",
    "standard":   "(keep current)",
    "spring":     "cubic-bezier(0.34, 1.56, 0.64, 1)",
    "springSoft": "cubic-bezier(0.34, 1.7, 0.64, 1)",
    "pour":       "cubic-bezier(0.22, 1, 0.36, 1)"
  },
  "distance": { "rise": 8, "reveal": 28, "row": 14, "lean": 7 },
  "stagger":  { "list": 50, "grid": 70, "cap": 8 },
  "scroll":   { "hideAfterDown": 36, "showAfterUp": 6, "resizeHold": 450, "miniAfter": 120, "solidAfter": 8 }
},
"glass":  { "blurBar": 22, "blurDock": 18, "saturateBar": 1.6, "saturateDock": 1.9, "tintMix": 22 },
"radius": { "pill": 9999, "card": 20, "cardLg": 28 },
"layout": { "headerHeight": 56, "headerHeightMobile": 52, "headerOffset": 14, "headerOffsetMobile": 10,
            "headerMax": 1440, "dockWidth": 420, "dockGap": 12, "dockHeight": 64,
            "drawerWidth": 480, "peekWidth": 440, "pageFull": 1440, "pageWide": 1200,
            "pageForm": 880, "pageNarrow": 560 },
"breakpoint": { "nav": 768, "navFull": 1280 },
"z": { "header": 30, "subnav": 29, "dock": 35, "sheet": 50, "toast": 60, "cursor": 90 },
"type": {
  "displayHero": { "size": 96, "lineHeight": 92, "weight": 800, "tracking": -0.045, "family": "display" },
  "kicker":      { "size": 11, "lineHeight": 16, "weight": 700, "tracking": 0.16, "family": "sans", "transform": "uppercase" },
  "navLink":     { "size": 13.5, "lineHeight": 20, "weight": 600, "tracking": 0, "family": "sans" }
}
```

Notes on the tokens:
- **Easing names.** The site's `--ease` equals Mizan's `enter`, and `--ease-sheet` equals `expand`. The site's `--ease-spring` is the new `spring`. CSS aliases: `--mz-ease` (= enter), `--mz-ease-spring`, `--mz-ease-sheet` (= expand).
- **Fluid gutter.** `--mz-gutter-fluid: clamp(16px, 4vw, 64px)` is emitted as one CSS line; it cannot live in `layout`, which holds px values only.
- **Arabic.** `:lang(ar)` already zeroes tracking, drops uppercase and uses ×1.15 line height; this now applies to `kicker` and `displayHero` too.
- **Reduced motion:** every duration maps to 1ms for animations and ≤120ms for transitions; `drift` maps to 0.
- **Press feedback:** `scale(.98)` everywhere (one value; today it is .99 in components and .97 on the site).
- **Focus and selection:** keep Mizan's monochrome 2px focus ring and the `brand-soft` selection. Do not take the site's red focus ring.

### 2.4 New CSS layers and components

**`css/chrome.css`** is new. It is exported in `package.json` and loaded in `reference/template.html`. It is framework-neutral, so the app (Tailwind), admin and the landing (CSS Modules) all use the same classes. All classes are scoped under `.mzg`.

| Class | Ported from | Notes |
|---|---|---|
| `.mz-topbar`, `.mz-topbar-bar` with `[data-tone=clear\|clear-ink\|glass\|light]` and `[data-hidden]` | `SiteHeader.module.css:1-87` | Pill (`radius.pill`) laid out as `grid 1fr auto 1fr`. Glass is `color-mix(in srgb, var(--bh-tint) calc(var(--mz-glass-tint-mix)*1%), var(--glass-solid))` with `blur(var(--mz-glass-blur-bar)) saturate(var(--mz-glass-saturate-bar))` and an inset rim (`inset 0 1px 0 rgba(255,255,255,.12)` dark, `.7` light), no drop shadow. The hide transform is `translateY(calc(-100% - 24px - env(safe-area-inset-top)))` over `glide` with `enter`. Tone crossfade: the `::before` opacity over 500ms. |
| `.mz-navlink` | site `.mid a::after` | Underline `scaleX(0→1)`, `transform-origin: var(--mz-o) 50%`, over `moderate` with `enter`. Hover only under `(hover:hover) and (pointer:fine)`; always shown on `[aria-current]`. `--mz-o` is 0 by default and 100% under `[dir=rtl]`, defined once on `:root`. |
| `.mz-tick` and `.mz-roll` | site tick and RollingText | Live line: 6px dot pulsing to opacity .3 every 2.6s (hidden ≤360px), and a 16px progress ring `conic-gradient(var(--mz-red) calc(var(--p)*1turn), var(--mz-rule) 0)`. Text roll: the outgoing line moves −110% and fades over 300ms; the incoming line rises from 110% over 450ms `enter` with a 120ms delay. |
| `.mz-cta-key` | site `.cta` | Ink pill with a 32px red key circle. The arrow rotates `calc(45deg * var(--mz-dir))` on hover over 500ms; `--mz-dir` is 1, or −1 in RTL. This replaces the site's physical rules at `SiteHeader.module.css:316-323`. On phones it collapses to a 42px red key with an sr-only label. |
| `.mz-dock`, `.mz-dock-blob`, `[data-mini]` | `MobileTabBar.module.css` | Centred with `inset-inline: 0; margin-inline: auto; width: min(var(--mz-dock-width), 100% - 32px)` (no `left: 50%`). Bottom `safe + 12px`, height 64. Mini mode `translateY(4px) scale(.84)` over `glide`, **CSS only**. Blob uses two edge springs (k .2 leading, .09 trailing, damping ×.7) that run in rAF **only during a tab change** (a few hundred ms), never on scroll. Labels use the registry's `short` label; a unit test asserts every dock label is ≤12 characters in EN and AR (fixes "Confirmati…"). |
| `.mz-sheet` | new | Bottom sheet. Enters `translateY(100%)→0` over `moderate` with `expand`; exits over `base` with `exit`. Scrim fade; drag handle; snap points 50% and 100%; `padding-block-end: env(safe-area-inset-bottom)`. With the on-screen keyboard open, the sheet and any sticky footer follow `visualViewport` (§3.2). |
| `.mz-drawer` | new | Side sheet from `inset-inline-end`, so it comes from the left in Arabic. 480px, or 440px for a peek. Open over `slow` with `enter`. |
| `.mz-reveal` | site `[data-rv]`/`[data-in]` | IntersectionObserver variant plus an `@supports (animation-timeline: view())` variant. Rise of 28px over `reveal`. Stagger 50ms, capped at 8 items. Content only hides once the script is live. |
| `.mz-pour` | site `CallSection` | `clip-path: circle()` fill over 750ms `pour`. **Landing only**, one per screen. |
| `.mz-flow` | new (§5) | Map lanes, particles (HTML `<i>` dots moved by WAAPI `transform: translate()` keyframes sampled from the lane path, §5.3) and health states. |
| `.mz-flash` | new | Row change flash: a `::after` overlay whose opacity fades 0 → .12 → 0 over 600ms (compositor-only); none under reduced motion. |
| `.mz-lock` | new (§10) | Locked field affordance. |
| `[data-spot]` | site `base.css:172-194` | Pointer spotlight, throttled with rAF (fixes PF-3 in `GlassRoot.tsx:15-23`). |

**`glass.css` physical-direction fixes,** applied in `glass-bridge.css` because `glass.css` is treated as the design team's file:
- `.seg-thumb left:4px` (l.160) and `.switch::after left:3px` (l.183) become `inset-inline-start`;
- `.nav-ind left/right:0` and `::before left:-1px` (l.211-214) become `inset-inline: 0` and `inset-inline-start: -1px`, with the RTL patch removed;
- `.ld-orbit .sat i margin-left` (l.286) becomes `margin-inline-start`.

Also confirm that `GlassRoot` puts `dir` on the `.mzg` element itself, because `.mzg[dir="rtl"]` rules (l.78-79, 130, 140, 214, 241) never match otherwise.

**Partner logos:** `logos/partners/<slug>.svg`, `<slug>-on-dark.svg` and `partners.json` (spec in §5.9).

### 2.5 `packages/ui` (new): one React kit for web, admin and the landing

Today `apps/admin/src/components/ui` copies the web kit, and the admin has its own `Shell.tsx`. Extract `packages/ui`:
- React 19 components over `@mizan/design-system` classes;
- **styling scope:** only `chrome/`, `brand/` and `motion/` are Tailwind-free (written against `chrome.css` classes and CSS variables), because the landing uses them. `page/`, `data/`, `record/`, `input/` and `status/` stay Tailwind and are app/admin only. No component is styled twice;
- its own vitest + Testing Library tests and a gallery entry for each component.

**Migration without breaking open branches:** `apps/web/src/components/ui/*.tsx` stays as **re-export shims** (`export { Button } from "@mizan/ui/input"` etc., same names and props) until the Studio and Template branches have merged and SH-6 is done. The shims are deleted in CLN-1. The same applies to admin's copy until DS-4c's e2e is green.

| Folder | Components |
|---|---|
| `chrome/` | `AppTopBar`, `HubLinks`, `HubMore`, `LiveLine`, `StoreChip`, `StoreSwitcherPopover`, `AvatarMenu`, `SectionNav`, `Dock`, `Sheet`, `Drawer`, `BannerSlot` |
| `page/` | `Page` (`width="full\|wide\|form\|narrow"`, gutter 16/24/32), `PageHeader` (eyebrow or breadcrumb, title, count/status, description, one primary action, secondary actions that fold into a Menu on phones, sub-nav slot; sticks under the bar and shrinks to a 44px title), `Breadcrumb`, `StickyActionBar`, `SaveBar` (moved), `LeaveGuard` (automatic wherever a SaveBar is used) |
| `data/` | `DataTable` v2 (below), `QueueChips`, `FilterSheet`, `ActiveFilterChips`, `PeriodPicker`, `EmptyState`, `Skeleton*`, `ErrorState` |
| `record/` | `RecordDrawer` (`?open=<id>`), `Pipeline` (`<ol>` with `aria-current="step"`), `NextStep`, `Timeline` (grouped by day, with filters) |
| `input/` | `ChoiceChips`, `Segmented` (grid thumb, no fixed widths), `RadioCards`, `Stepper` (Arabic-digit safe, replaces native number inputs), `Combobox`, `DateRangePicker` (Intl, AR/EN), `CurrencyInput` (code prefix), `DropZone` + `ImportPreview` |
| `status/` | `StatusChip` (domain status → success/warning/danger/info/neutral tokens, icon + text; replaces every grey-dot pill), `Countdown` (`role="timer"`, value printed), `ProgressRing` |
| `brand/` | `PartnerLogo`, `SourceField` (§10), `FlowMap` (§5), `RollingText`, `Figures` |
| `motion/` | `useReducedMotion`, `useMediaQuery` (`useSyncExternalStore`), `useHideOnScroll`, `HeaderProvider`, `useHeader`, `useHeaderState` (split contexts, setters that bail out when nothing changed), `useUrlState` |

**`DataTable` v2:**
- `rowHref` makes the whole row a link; ⌘-click opens a new tab.
- Keyboard: `j/k`, ↑/↓ and Enter.
- `mobile="cards"` with `cardRender`: below 768px each row becomes a card (id, status chip, amount, one sub-line, next action), and the whole card is the tap target with 44px rows.
- `density` setting; server-side sort hooks; selection with "select all N matching".
- Stagger only on the first page.
- Sticky header against the page: `overflow-x: clip` on wide screens, otherwise a sticky header clone. This fixes PG-6 (`components.css:121-123`).
- Virtualization past 100 rows.
- The empty state renders outside the scroll area (fixes the clipped Purchasing empty state).

**`Tabs`:** URL state by default (`useUrlState`); edge-fade masks; the active tab scrolls into view; a sliding underline uses `.mz-navlink`.

**Dialogs:**
- Exit animation through `@starting-style` and `transition-behavior: allow-discrete` (today the content unmounts before `close()`, `Dialog.tsx:101,144`). The top-layer exit needs `overlay` support, which Firefox and Safari may lack **[CONFIRM]**: the close animation is progressive there, with an instant close. Nobody chases parity.
- Below 768px every dialog renders as a `Sheet`.
- **Never nest dialogs.** `CancelAtCourier` inside `SetStatusDialog` (B7) becomes a step inside that dialog.

**Toasts:**
- Below 1024px: centred, at `bottom: calc(88px + env(safe-area-inset-bottom))`.
- Pause on hover or focus; exit by fading down over 200ms; swipe to dismiss; stacking motion.
- Default: adopt Sonner pinned at an exact version, themed with tokens. It gives these behaviours for free.

### 2.6 Brand 2.0 and event motion (BR-1)

The owner's Brand 2.0 pack replaces the marks and adds motion: "use animated events for all the events, centralise them and use them systematically". Colours are unchanged (ink `#0B0B0B`, paper `#FEF7FF`, red `#DE0000`, red on ink `#E33232`); Geist, Geist Mono for every figure, Alexandria for Arabic.

- **Catalogue model.** One map per event family in `packages/shared/src/motion`: `EVENT_MOTION` (every `DOMAIN_EVENT_TYPES` entry, checked by type and at runtime), `TIMELINE_MOTION` (every order timeline type), `ENGINE_MOTION` (the integration engine's own events, with an audience). Each rule names an **outcome** (`settle`, `done`, `merge`, `tip`, `fail`, `drop`, `quiet`), an optional **pending** loader (`pair`, `transfer`, `drop`, `fill`), its **surfaces**, its copy key (AR/EN) and, where the outcome depends on a non-PII field, a variant (`order.payment_changed` by state: paid drops, failed tips). `motionFor` resolves an event to its motion. The ops app gets a generated Dart copy (`apps/ops/lib/motion/event_motion.g.dart`); `docs/13` §2.1 gets a generated table. Both are checked by tests.
- **Surfaces.** `button` (busy loader, then the outcome), `toast`, `bell`, `timeline`, `card`, `list`, `kpi` (roll), `sync` (`SyncPill`), `queue`, `instrument` (gauge, vessels, breakeven, bullseye), `banner`. A screen never picks an animation: it calls `useEventMutation(type)`, `toast.event(type)` or renders a primitive bound to the event (Flutter: `EventLoader(type)`, `showEventSnack(type)`), and the catalogue decides.
- **Scheduler rules** (`packages/design-system/motion/scheduler.ts`): seen ids (an LRU of 2,000 drops replays); history and resync refresh data with no motion; an echo of the viewer's own success within 8 s plays nothing; the same surfaces and merge key within 600 ms merge into one dispatch with a count; rate limits (4/s, per surface 400 ms, the bell 2 s, one DROP per 3 s); overflow starts a 5 s storm that ends in one batched "N new"; a hidden tab plays nothing and the bell gets one summary on return; reduced motion still dispatches, flagged, and surfaces crossfade; unmounted surfaces drop silently. The scheduler holds ids, types and timestamps only: no event data, nothing in storage.
- **Red budget.** One red per view. The shell uses mono marks, so the content owns the red; auth, splash, boot and outage use the full-colour mark as their one red. A DROP outranks a loader and releases the red after its ripple; a refused claimant renders mono. Money going out never gets red; DROP is only for the checked-in allowlist (confirmed orders, paid payments, …).
- **Reduced motion.** Still frames chosen on purpose (pair level and apart, transfer balanced, drop at rest, fill with its percentage), no rAF or ticker, reduced durations ≤120 ms.
- **Consumers to come.** CN-3 (the connections map) uses `SyncPill` and the edge states from the catalogue; A-11 (the Event Center) lists `EVENT_MOTION` and `ENGINE_MOTION` with `EventGlyph` rows and filter chips per outcome. BR-2 places the instruments on real screens, BR-4 feeds live events into the scheduler, BR-5 bridges engine events, BR-6 gives imports and exports real progress (`docs/10-backlog.md`).
- **Ops app (§4.25).** Same catalogue and tokens: Lottie loaders from the pack, `FillBar`, `VesselsCount`, scan glyphs with haptics, event toasts, the splash and launcher icons from the new mark.

---

## 3. App shell and information architecture

### 3.1 Shell decision

**Desktop and tablet use a Brandita floating top bar; on phones a dock replaces the bottom bar.** The 22-item side rail goes away. This is a big departure: the Brandita header has only 2 mid links, while Mizan has 8 hubs, and the brandita-site audit (§5.3) recommended keeping a rail at ≥1280. So it is **owner decision D17**, with this default:
- the top bar with hubs as the main navigation at every width;
- an **optional 64px icon rail at ≥1280** (hub icons + labels on hover/focus, same registry), off by default, switched on per user in My account → Appearance and remembered server-side in user preferences;
- the whole shell v2 ships behind the A-6 per-store flag `shell_v2` (§11.0b), so pilot stores keep today's shell until the owner turns it on for them.

**Brandita motion in the app:** the app takes the navlink underline, RouteMotion easing (swapped to `--mz-ease` in DS-2), RollingText, the tick and the dock blob. The Brandita cursor, attach, pour and Liquid kit stay **landing-only** (recorded in D1/D2). List → detail continuity uses `<ViewTransition>` as a progressive enhancement (SC-1, SC-2).

```
.mz-topbar  [data-tone="glass"|"light"] [data-hidden (only <1024 and no layer open)]
 └ bar (pill, max-inline-size 1440, height 56 / 52 on phones, top = safe-area + 14 / 10)
    start: ThemedWordmark (both exports crossfaded) · divider · StoreChip (logo + name, locked to the channel; role; opens the switcher popover)
    mid:   HubLinks (.mz-navlink + count badge with RollingText) · "More ▾" (priority+ overflow, measured)
    end:   LiveLine · Search (⌘K field at ≥1280, icon below) · Bell · AvatarMenu · context primary action (.mz-cta-key)
 SectionNav row (sticky under the bar: hub children, sliding indicator, gear → this hub's settings)
 BannerSlot (one banner, by priority)
 <Page><PageHeader/>…</Page>
 Dock (<768 only)
```

**Live line** (`LiveLine`, replacing `SyncIndicator` and most banners). One channel with a priority order:
1. outage or a broken connection: red dot, opens that Connections node;
2. support access is active (the A-3 banner stays a banner as well; this is a legal requirement);
3. import running: progress ring, "بنسحب 340 أوردر";
4. trial: "فاضل 5 أيام في التجربة";
5. past_due / restricted;
6. automation failures;
7. otherwise, the page's own tick (for example "12 محتاجين مكالمة").

It is `aria-live="polite"`, truncated to 28ch at 1024–1279, and numbers go in `<bdi>`.

**Context primary action:**

| Hub | Action |
|---|---|
| Orders | "أوردر جديد" / "New order" |
| Catalog | "أمر شراء جديد" / "New PO" |
| Connections | "اربط" / "Connect" |
| Customers | "تذكرة جديدة" / "New ticket" |
| Trial, any page | "Upgrade · N days left", shown only when no other context action applies |

There is at most one red key per screen.

**AvatarMenu:** name and role, My account (`/account`), two-step, language, theme, Settings, send feedback (moved out of the bar), help, sign out. The sign-out button leaves the bar (SH-1).

**Hide on scroll:** below 1024px only, and never while a menu, sheet, dialog or ⌘K is open (`data-hidden` is gated on `!anyLayerOpen`). On desktop the bar stays and turns solid after 8px of scroll.

**Banner slot priority:** support access > outage > legal > billing (past_due/restricted/trial ≤2 days) > plan limits > announcement. One at a time, each dismissible per day where policy allows. Banners render as glass cards inside the page gutter, not as edge-to-edge strips.

**Frame before the gate (SH-7):** paint the bar, the hubs (from the role cached in the session) and the skeleton page immediately. Gate only `children` on Firebase, `/me` and the store check. `BootLoader` is used only when the user or store is unknown.

**Fast data (PF-1 and the visual audit's 4–13s settle times):**
- start the page's first query **in parallel** with the store check (the query key carries the cached store id; it is discarded if the check changes the store);
- `<Link prefetch>` plus a `queryClient.prefetchQuery` of the hub's first list on hub hover/focus (fine pointers) and on dock touchstart;
- render cached data first: TanStack `placeholderData: keepPreviousData` on lists, and a session-scoped persisted query cache (sessionStorage, try/catch, PII-free queries only; order/customer detail is never persisted) so a return visit paints data instead of skeletons.

**Landmarks (SH-9):** `<header>` for the bar, `<nav aria-label>` for HubLinks, SectionNav and the dock (distinct labels), `<nav aria-label="breadcrumb">` for breadcrumbs, one `<main>`; checked by axe in SH-3.

### 3.2 Responsive rules

| Width | Bar | Navigation | Page | Lists | Detail | Overlays |
|---|---|---|---|---|---|---|
| <640 | 52px pill: mark, store logo, live line (dot hidden ≤360), red "+" key | Dock 64px + safe area: 4 per role + More (Sheet holding the hub grid, store switcher, settings, account). SectionNav is a chip row with edge fades | Gutter 16; title 22px; sticky StickyActionBar above the dock | Cards; filters in a Sheet; optional swipe actions with a tap fallback | Single column in priority order | Dialogs become Sheets, drawers go full screen; toasts above the dock |
| 640–767 | + store name, search icon | Same as phone | Gutter 24 | Cards, or a two-line table | Single column | Same as phone |
| 768–1023 | 56px pill; hubs via priority+ (about 4 visible + More); search icon; hides on scroll | No dock. SectionNav as a segmented row. Settings side list shows from 768 | Gutter 24; two-column forms | Table with priority columns (`hideBelow`); row opens a PeekDrawer (440) | 2 columns (3/5 + 2/5) | Centred dialogs; drawers from the inline end |
| 1024–1279 | Full pill, short hub labels, More ▾ | SectionNav row | Gutter 32; `Page` widths | Full table, sticky header, `j/k` | 2/3 + 1/3 with a sticky side column | — |
| ≥1280 | Full labels, 288px search with ⌘K hint, labelled red key | — | Content 1440, centred | Orders and tickets: optional split view (list 420 + detail) | — | — |

Ops roles on tablets: warehouse users on iPads keep the dock in portrait if their role is `warehouse`. This is a per-role rule in `nav.ts`.

**Input-mode and viewport rules** (apply on top of the width table; each has a case in the responsive contract e2e):

| Condition | Rule |
|---|---|
| Landscape phone: `(max-height: 500px) and (orientation: landscape)` (e2e case 844×390) | The dock is hidden; the bar becomes a 44px mini bar (mark, live dot, "More" opening the hub Sheet); hide-on-scroll on; sticky action bars stay but at 48px; sheets open at 100% height |
| Coarse pointer at any width (`(pointer:coarse)`: touch laptops, iPads, foldables) | Row actions always visible (no hover-only reveal), 44px targets, swipe actions enabled, glass cards solid (§1.9), spotlight off |
| Foldables / dual screens (`(horizontal-viewport-segments: 2)`, progressive) | List on one segment, detail on the other (the ≥1280 split-view layout); otherwise follow the width table |
| On-screen keyboard (iOS/Android) | Viewport meta `interactive-widget=resizes-content`; the dock hides while an input is focused; StickyActionBar, SaveBar and sheet footers position from `visualViewport` (`height` + `offsetTop`) so they sit above the keyboard; the focused field scrolls into view with `scroll-margin-block` for the sticky bar |
| Tablet with hide-on-scroll and a sticky SectionNav | Both layers translate together as one group (one transform on a shared wrapper) to avoid two sticky layers fighting; verified on real iPad hardware in SH-3 |

### 3.3 Navigation tree (every route mapped)

Rule: what the team does every day is a hub; what is set once lives in Settings; Connections is a hub because it has live state. The registry stays single (`lib/nav.ts`), extended with:
- `children[]` (key, href, `can`, keywords, `count?`, `flag?`);
- `settingsHref`, `short` (label for 1024–1279) and `hubOrder`.

⌘K is fed by hubs, children, settings and connections. A new test checks that every route file is either in the registry or in an explicit `HIDDEN` list (details, `/new`, redirects).

| Hub (AR / EN) | Children (route) | From today | Settings gear |
|---|---|---|---|
| **النهارده / Today** | Overview `/` · My work `/inbox` (new, U13) | `/` (home) | — |
| **الأوردرات / Orders** | All `/orders` · Calls `/confirmation` (label "مكالمات التأكيد / Calls"; URL unchanged) · Duplicates `/orders?queue=duplicates` · Waiting for stock `/orders?queue=waiting_stock` · Failed booking `/orders?queue=failed_booking` · New `/orders/new` · detail `/orders/[id]` · print `/print/orders` (outside the frame) | `/orders`, `/orders/[id]`, `/orders/new`, `/confirmation`, `/print/orders` | `/settings/orders` |
| **التجهيز والشحن / Fulfil** | Ship `/shipping?view=ship` · Track `/shipping?view=track` · Fix `/shipping?view=fix` · Returns `/returns` (new) · Pick lists `/stock/picklists` (moved here) · Couriers `/shipping?view=couriers` | `/shipping`, `/stock/picklists` | `/connections` (courier nodes) |
| **المنتجات والمخزن / Catalog** | Products `/products` (+ `/products/[id]`) · Stock `/stock` · Purchase orders `/purchasing` (+ `/purchasing/[id]`, `/purchasing/new`) · Suppliers `/purchasing/suppliers` · Reorder `/purchasing/reorder` | `/products*`, `/stock`, `/purchasing*` | `/settings/inventory`, `/settings/purchasing` |
| **العملاء والدعم / Customers** | Customers `/customers` (+ `/customers/[id]`, new M9) · Tickets `/tickets` (+ `/tickets/[id]`) · Inbox `/inbox/chats` (M17, flag) · Support from Mizan `/support` (new, §8) | `/tickets*` | — |
| **الفلوس / Money** | Profit `/profit` · Ads and ROAS `/profit/ads` · Ad spend `/profit/spend` · Payments `/payments` · Refunds `/payments?view=refunds` · Disputes `/payments?view=disputes` (+ `/disputes/[id]` evidence) · Settlements (M8, flag) · Commissions (M10, flag) · Finance (M19, flag) | `/profit*`, `/payments`, `/disputes/[id]` | `/settings/costs`, `/settings/payments`, `/settings/refunds` |
| **التقارير / Reports** | Dashboards `/reports` · Metric dictionary (a side sheet reachable everywhere, not a tab) · Exports | `/reports` | — |
| **الأتمتة / Automations** | Automations `/automations` (+ `/automations/[id]` canvas, new) · Recipes `/automations/recipes` · Run log `/automations/runs` | `/automations` | — |
| **الربط / Connections** | Map `/connections` · node `/connections/[connectionId]` (drawer through an intercepting route) · catalogue `/connections/add` · Activity `/connections/activity` | absorbs `/settings/integrations`, `/settings/store-sync`, `integrations/shopify/connect` (kept as an OAuth return URL) | — |

**Settings** (avatar menu → Settings; plus gear deep-links from hubs). Side list from 768px; on phones, a list at `/settings`.

| Group (AR / EN) | Pages |
|---|---|
| المتجر والبراند / Store and brand | Store profile `/settings/store` (channel fields locked, §10) · Sales rules `/settings/orders` · Offers `/settings/offers` (hands-off) · Legal (moved out of the Store card) |
| التأكيد / Confirmation | Confirmation Studio `/settings/confirmation` (**label and group only**) · After confirmation `/settings/after-confirmation` (hands-off) |
| الفلوس / Money | Costs and FX `/settings/costs` · Payment methods and fees `/settings/payments` (absorbs `payment_fee_pct` from Costs, plus COD conversion) · Approvals `/settings/approvals` (new card holding the refund and PO approval amounts; `/settings/refunds` redirects here, and the purchasing approval moves here) |
| المخزن / Stock | Inventory `/settings/inventory` (the "send counts to Shopify" switch moves to the Shopify node, with a deep link back) · Purchasing `/settings/purchasing` (reorder maths) |
| الفريق والصلاحيات / Team and access | Team `/settings/team` · Roles `/settings/roles` (read-only view generated from `PERMISSIONS`) |
| الباقة والفواتير / Plan and billing | `/settings/billing` (overview, plans, invoices, payment method, usage merged in) · `/settings/usage` redirects here |
| البيانات والخصوصية / Data and privacy | Privacy `/settings/privacy` · Audit log `/settings/audit` · Data export |
| (not store settings) | My account `/account`: profile, two-step, sessions, language, theme, notification preferences |

**Redirects** (permanent, the same pattern as `settings/ads/page.tsx`):

| Old | New |
|---|---|
| `/settings/integrations` | `/connections` |
| `/settings/store-sync` | `/connections/<first shopify id>?tab=settings` |
| `/settings/usage` | `/settings/billing#usage` |
| `/settings/refunds` | `/settings/approvals` |

Every "fix" link in the app (`IntegrationsScreen.tsx:62` `fixHref`, `SyncIndicator.tsx:61`, `NotificationBell.tsx` `hrefOf`, the Home leaks) deep-links to `/connections/<id>`. They no longer point to `/onboarding`.

**Dock per role** (`PRIMARY` in `nav.ts:63-71`):

| Role | Dock items (then More) |
|---|---|
| owner / admin | Today, Orders, Fulfil, Money |
| agent | Calls, Orders, Customers, Today |
| warehouse | Fulfil, Catalog, Orders, Today |
| media buyer | Ads (`/profit/ads`), Profit, Reports, Today |
| finance | Money, Payments, Reports, Today |

Shipping moves onto the owner's dock; today it takes two taps.

**Admin nav** (`apps/admin/src/components/Shell.tsx`), on the same `AppTopBar` from `packages/ui`:

| Group | Pages |
|---|---|
| Operate | Event Center `/events`, Incidents `/incidents`, Cases `/cases`, Dunning `/billing/dunning` |
| Stores | `/stores`, store-360 `/stores/[id]` |
| Money | Subscriptions `/billing/subscriptions`, Revenue `/billing/revenue`, Catalogue (`/billing/prices`, `/billing/coupons`), Billing settings `/billing/settings` |
| People | Users, Staff |
| Platform | Flags, Announcements, Health (infrastructure tab), Holidays (dunning calendar, §7.2) |
| Trail | Staff audit |

Every admin page gets a screen spec in §4.24 (not only the new ones).

---

## 4. Screen-by-screen redesign

**P0 fixes go first** (milestone FX-1), before any screen work:
- B1: `useTranslations("problem")` appears in 20 files; it becomes `"problems"`, plus a namespace-existence test **and an ESLint rule** (`no-unknown-i18n-namespace`, reading the message files). None of the 20 is a hands-off file, so nobody "fixes" the Studio branch copies. The files: `automations/Automations.tsx`; `purchasing/{PurchaseOrderDetail,NewPurchaseOrder,SuppliersScreen,ReorderScreen}.tsx`; `tickets/{TicketDetail,NewTicketDialog}.tsx`; `settings/{UsageScreen,RefundSettingsScreen,PurchasingSettingsScreen,PrivacyScreen,OrderSettingsScreen,EngineHealth,CostsScreen,ConversionSettingsScreen}.tsx`; `payments/{Refunds,Disputes}.tsx`; `orders/{ReturnsCard,LedgerCard,ConversionCard}.tsx`.
- Money: one `formatMoney` contract (§1.2) with a test, replacing the "US$ 785.95" / "$785.95" / "EGP 749.95" mix.
- Client-hard-coded provider lists become catalogue-driven (X9): `PaymentMix` `METHODS`, `NotificationBell` providers, `CostsScreen` `FEE_METHODS` read the shared catalogue constant (`packages/shared`, the same one `/v1/integrations/catalog` serves, §5.6); Automations and Costs couriers are already covered in SC-15/SC-17.
- B2: hard-coded `"، "` becomes `Intl.ListFormat`, and `` `${qty}× ${title}` `` becomes an ICU message.
- B3: raw field names in the timeline go through `fields.*`.
- B8: a single `useOrderProducts()` hook.
- B6: print buttons above 100 selected stay visible but disabled, with a reason.
- Home and onboarding phone overflow (`ProfitChart.tsx:26-31,73` `width={W}` and a missing `min-w-0`; `OnboardingWizard.tsx:85-92` grid without `minmax(0,1fr)`).
- Bidi: `LegalCard.tsx:25,31` dates get `dir="ltr"`; names get `<bdi dir="auto">`; team phone examples are wrapped one by one.
- `ActivityLog.tsx:48-52` gets the missing keys and a generic fallback (shared key shape with `AuditLogScreen.tsx:67`).
- The theme gets one source of truth (`GlassRoot` and `data-theme`).
- Server strings "Store courier" (`shipping.service.ts:155`) and the "Customer" placeholder become codes the web translates.
- The Home welcome example currency uses `store.baseCurrency` (`HomeWelcome.tsx:52`).
- `IntegrationsScreen` gets `whatsapp_cloud` and `manual` names (en.json:3665-3671).

**Patterns shared by every screen:** `Page` + `PageHeader`, `QueueChips` instead of 6–11 tabs, `FilterSheet` instead of always-open selects, `DataTable` v2 with phone cards, `RecordDrawer` with `?open=`, `StickyActionBar`, `StatusChip`, `PartnerLogo` wherever a provider, platform or method appears, `PeriodPicker` kept in the URL (`?days=`) across Home, Profit, ROAS and Reports, and live updates through `useLiveTopic` (§4.0).

### 4.0 Live updates (shared)

- API: `GET /v1/live?topics=orders,order:{id},shipments,confirmation,tickets,refunds,connections,notifications,support` (SSE) fans out the domain-events outbox per tenant.
- Auth: `POST /v1/live/token` returns a 60s signed token passed in the query string, because `EventSource` cannot send headers. Hardening:
  - the token is **single-use** (a `jti` consumed on connect) and bound to tenant + user + the requested topics;
  - the hook disables native auto-reconnect (closes on `error`) and mints a fresh token for every reconnect, with jittered backoff;
  - `token` is stripped from URLs in the redacting logger (`platform/logging/redact.ts`), in APM, and in the Front Door / Container Apps access-log config (`infra/`), with a test on the logger.
- Heartbeat `:\n\n` every 15s (Azure Container Apps closes idle connections). Served from the DB, so any replica works. Check `@Sse()` on Fastify through `hardening.ts` and compression. **[CONFIRM]** that Front Door and the ingress do not buffer SSE: LV-1a acceptance includes an SSE smoke test through staging ingress.
- Web `useLiveTopic(topic)` invalidates the matching TanStack keys. Fallback: polling every 15s, never in the background.
- Phones: close the stream on `document.hidden`, `pagehide` and `freeze`; reopen on `visibilitychange`/`resume`; when `navigator.connection.saveData` is on, use 60s polling instead of SSE.
- UI:
  - a changed row flashes once (`.mz-flash`: `::after` opacity fade over 600ms; none under reduced motion);
  - new rows on a scrolled list show a "3 أوردرات جديدة" pill instead of moving rows under the cursor;
  - status badges crossfade;
  - a row leaving a queue fades out (opacity 150ms), then collapses with `grid-template-rows: 1fr → 0fr` over 200ms, one row at a time (the stated layout exception in principle 5); batches of more than 3 rows leave without animation.
  - Hub and LiveLine counts roll at most once per 2s per badge (§1.9).

### 4.1 Today (Home, `/`; `components/home/*`)

Problems:
- Phone overflow (fixed in FX-1).
- The hero says "اللي فضل معاك 43,518.54" at 100% margin with nothing delivered and every cost missing (P0 trust).
- The new-store check is a guess (`ProfitHome.tsx:71`).
- SetupCard sits above the hero and duplicates the rail checklist.
- Leak links go to the wrong place (`ProfitHome.tsx:35`: `cost_missing → /onboarding`).
- PaymentMix returns `null` and leaves a grid hole.
- The chart works with a mouse only (X6).
- Two ping dots; long KPI hints.
- Activity and the bell use different key shapes.

New design, top to bottom:
1. **Greeting strip:** StoreChip, `PeriodPicker`, "live · 14:32" (RollingText).
2. **Hero:**
   - Kept amount, change, per-100 and expected, plus 4 KPI tiles. Each tile opens a popover (desktop) or sheet (phone) with its definition from `/v1/metrics/catalogue` and a "See orders" link.
   - KPI hints are one short line (≤32 characters in Arabic at 390px, with `text-wrap: balance`); the long explanation moves into the tile's popover/sheet (screens-insight 1.7).
   - **Honesty rule:** when costs are missing or nothing is delivered, the label becomes "ربح مبدئي / Provisional profit". The figure gets a "~" prefix and a dashed underline, and a chip reads "ناقص تكلفة 12 منتج" and opens the cost sheet in place. "اللي فضل معاك" is shown only for delivered orders with costs present.
3. **Action inbox** (beside the hero on desktop, right after it on phones). It replaces Leaks and is ranked by money impact. Each row has an icon, one line, money and a direct fix:
   - `cost_missing` → inline cost sheet (`/products?view=missing_cost`);
   - `sync_gap` → `/connections/<id>`;
   - `fx_missing` → `/settings/costs#fx`.
   It is fed by `GET /v1/inbox` (U13), which also feeds the hub counts.
4. **Setup path card,** shown only while setup is incomplete: 4 nodes (store → courier → costs → first order) in the FlowMap node style. The current node pulses; done nodes fill. When complete it folds into a ring on the avatar. The new-store check uses `onboarding.steps.store.status` and `firstOrder`, not zero sums.
5. **Charts:**
   - `ProfitChart` is fluid (`width="100%"`), takes pointer events with `touch-action: pan-y`, has a scrubber with a sticky readout on touch, and a bidi-safe tooltip.
   - Sparse data (fewer than 5 active days) draws bars per day instead of an area.
   - PaymentMix uses method logos; with no data it shows a placeholder ring and "مفيش أوردرات مدفوعة في الفترة دي"; with fewer than 5 orders it shows a list instead of a donut.
6. **Activity:** an event stream that shares row components with the bell (§4.22), with filter chips (Orders, Money, Team, Connections).

Mobile order: hero, Action inbox, setup card, charts, activity. One live dot only.

### 4.2 Orders list (`/orders`; `OrdersScreen.tsx`, `OrderFilters.tsx`, `BulkActions.tsx`)

Problems:
- About 280px of chrome: 7 always-open selects, 11 tabs and a search box. On phones the first order sits at about y=900.
- `mm/dd/yyyy` dates; queues and statuses mixed in one strip.
- The saved view is a select with no "changed" state.
- No row actions, no sort, no live updates.
- The bulk bar scrolls away (B5); no preview before a bulk change.

New design:
- `PageHeader` with search (number or phone; `/` focuses it) and the context key "New order".
- **Queue chips** (work, with counts): Needs a call · Duplicates · Waiting for stock · Ready to ship (→ Fulfil) · Failed booking.
- **Status segmented control:** All · New · Confirmed · Shipped · Delivered · Returned · Cancelled.
- **Filters (n)** button opening a `FilterSheet`: date range (Intl), store with logos, source, payment mode (chips), city, courier, risk. Active filters show as removable chips. Saved views are pinned chips ("★ Cairo COD") with a "changed · save / reset" dot.
- **Table columns:** order (id + platform logo + relative age), customer (masked, `<bdi dir="auto">`), city/zone, items (thumbnails, neutral placeholder icon when there is no image), payment pill ("COD · 1,150 to collect" / "Paid · card"), status chip, risk (only medium or high, with a legend tooltip).
- Server-side sort: age, total, risk.
- **Row actions** at the inline end: Confirm, Call, Ship, ⋯. Shown on hover or focus with a fine pointer; **always visible under `(pointer:coarse)`** at any width (touch laptops, iPads). The row opens the order `RecordDrawer` (≥768); the list keeps its scroll; `j/k` moves the drawer through the list. List → drawer continuity uses `<ViewTransition>` where supported (progressive, crossfade otherwise).
- **Bulk:** a sticky bottom `StickyActionBar`: "23 selected · Confirm · Ship · Tag · Assign · Print ▾ · ⋯ Cancel".
  - "Select all 412 matching" applies to the filter. The API accepts `filter` as well as `orderIds`.
  - The confirm sheet previews the effect: "12 COD · 3 prepaid · 2 already confirmed, skipped".
  - Progress shows as a toast with a ring that expands into a results list.
- Live: `orders` topic with the "N new" pill.

Mobile:
- Card: `#1042 · status`, then `customer · ••• 4432`, then `City · COD 1,150 EGP`, with age at the inline end.
- Swipe toward the inline end to confirm, the other way for more (mirrored in RTL), always with a tap fallback through ⋯.
- The queue chips row scrolls; Filters is a single button.

### 4.3 Order detail (`/orders/[id]`; `OrderDetail.tsx` + 17 cards)

Problems:
- 19 cards and about 11 fetches.
- Confirm sits in the 4th side card and Ship in the 6th main card; on phones it takes about 12 cards of scrolling.
- No lifecycle picture; money in 3 places (Money and Payments repeat five totals).
- The reveal is a separate click before calling.
- Native inputs in DoorCard; Edit is a large centred dialog.
- Staging shows 43,518.54 profit on a 785.95 US$ order at 100% margin.

New design (the same component serves the page and the drawer):
1. **Header:**
   - `#1042` (mono, `<bdi>`), platform logo, relative date (full date on hover).
   - **Pipeline:** New → Confirmed → Packed → Shipped → Delivered, with a Returned/Cancelled branch. The current step is filled red. Sub-states: "awaiting payment", "booking…" (pulse), "failed attempt" (warning).
   - Payment pill and a ⋯ menu: print invoice, print slip, duplicate, open in store, copy link.
   - **Locked:** order number, `placedAt`, the store name (`o.store`) and the channel's unit prices carry the lock affordance ("من Shopify").
2. **Next step panel** (state-driven; on phones it becomes the `StickyActionBar`):

   | State | Panel |
   |---|---|
   | new / pending | Confirm (primary), Call, Send WhatsApp link, Cancel; plus the run line ("WhatsApp read 4 min ago · auto-call at 14:30") |
   | confirmed | "Ship with [Bosta logo]" (primary; courier choice when more than one is connected; needs `POST /v1/orders/{id}/ship` to take `{ connectionId? }`), Record by hand. On a failed booking: the reason in merchant words, **Fix address** (opens the edit sheet at the address), Try again |
   | shipped | Courier, tracking (copy), live status, Partial delivery, Refused at door |
   | delivered | Exchange, Refund, Inspect return (when eligible) |

3. **Tabs,** each loaded when opened. A combined `GET /v1/orders/{id}?include=lines,money,customer,shipping,confirmation` serves the first paint.
   - **Overview:** items; a money summary (total · paid · to collect via `cashToCollect` · refunded); profit (provisional when costs are missing); customer; address with a map pin; risk only when medium or high; notes and tags inline (optimistic, with Undo).
   - **Conversation** **[WAITS: Studio]:** the WhatsApp thread rendered read-only with the Studio's `WhatsAppPhone` bubbles (ask the Studio branch for a `readOnly` / `transcript` prop; do not fork it), plus call outcomes on the same timeline. Until it merges, keep today's ConfirmationCard rows.
   - **Money:** ledger, refunds, disputes, conversion to prepaid, profit breakdown. One place for money.
   - **Shipping:** shipments with inline history (replaces `HistoryDialog`), the door outcome, returns and inspection, exchanges.
   - **Activity:** the timeline grouped by day with filters (status, payment, team, system), plus "Sync history" (from the Event Center, §8.6).
4. **Edit in place:**
   - "Change address" edits inline with `AddressFields`.
   - Lines and fee open an edit `Sheet` with a sticky footer.
   - The DoorCard becomes one "At the door" sheet: segmented Delivered all / Kept part / Refused, reason chips, an "Opened the box" Switch, and Steppers.
5. **Reveal:** "Call" and "WhatsApp" reveal and act in one tap, with the caption "الرقم اتكشف واتسجّل". The revealed number stays in component state only.
6. **Motion:** the pipeline fills on a live status change; the next-step panel crossfades; each change gets a toast with Undo where the API allows it (tags, notes, assignment).

Mobile:
- Header, pipeline (horizontal, scrollable), then tabs as a chip row.
- The sticky next-step bar sits above the dock.
- From 768px, 2 columns: main tabs plus a side column with customer, payment and next step.

### 4.4 New order (`/orders/new`; `NewOrder.tsx`)

Keep the step flow and the review. Changes:
- On phones, a sticky bottom bar: "الإجمالي 1,150 · هيتحصّل 1,150 · راجع →".
- Source as icon chips with real marks (Phone, WhatsApp, Instagram, Facebook, TikTok, walk-in).
- Payment mode as `RadioCards` that explain what the courier collects.
- A known customer gets a single "Fill from last order" banner.
- − and + become icon buttons in a `Stepper`.
- Fix: step 4 shows a check before it is filled.
- Shipping fee: suggest the courier rate from Costs (editable).

### 4.5 Call queue: call mode (`/confirmation`; `CallQueue.tsx`)

Problems:
- 4–6 clicks per call: Next → reveal → tap the number → outcome → reason dialog → Next.
- No auto-advance; stale state when the customer confirms on WhatsApp mid-call.
- Reuses the full order card; the call card is last on phones.
- The empty-state panel is oversized; results duplicate the KPIs.

New design (focus layout inside the frame; the SectionNav stays):
- **Inline start:** customer name, a big **Call** button (reveal + `tel:` with the log caption), WhatsApp, "Try 2 of 3", risk only when high, history ("3 delivered · 1 refused").
- **Centre:** the script in large type with the lines and "to collect" filled in, plus the offer box. It renders `s.script` as the Studio defines it, read-only. **[WAITS: Studio]** for any new script features.
- **Bottom outcome bar:** Confirmed (`C`), No answer (`N`), Cancel (`X`, reasons as chips), Ask a change.
- After an outcome: 1.5s "اتسجّل · اللي بعده في 3…" with **Undo**, then the next order is auto-claimed. A Pause toggle stops this.
- **Inline end:** Up next (5, masked) and a one-line stat strip that replaces the 4 StatCards.
- Live (`confirmation` + `order:{id}`): "Customer just confirmed on WhatsApp · skip" banner, then auto-advance.
- Results move to a "Results" tab, using the existing ConfirmationResults component as-is.
- Empty queue: one compact empty state ("مفيش مكالمات دلوقتي") with the next scheduled auto-call time.

Mobile: the same flow; the outcome bar is sticky and sized for one hand; the script scrolls between header and bar.

### 4.6 Confirmation Studio and template choice (`/settings/confirmation`): hands-off

Only these changes are allowed:
- the menu label "استوديو التأكيد / Confirmation Studio" and its group;
- **after merge:** `PageHeader` instead of the hand-written `<h1>`; Studio literal durations and curves switched to the §2.3 tokens; the shared SaveBar; **[WAITS: Template]** the template choice in the Studio toolbar (the owner's next step).

The WhatsApp connection (number, verified name, quality, tier) is shown on the WhatsApp map node, which links back into the Studio. It is never duplicated.

### 4.7 Fulfil: shipping (`/shipping`; `ShipmentsScreen.tsx`, `ReadyToShip.tsx`, `Scorecard.tsx`, `StatusImport.tsx`, `CancelAtCourier.tsx`)

Problems:
- 6 tabs; the scorecard renders under every tab.
- Ready-to-ship has no zone, address quality, courier or item count, and no visible row action.
- The review queue isn't workable (no grouping by raw status).
- Native file input; nested dialogs (B7); text courier names; "Cairo" and "sheraton" in Arabic tables; a scrambled bidi header line.

New design: sub-nav **Ship · Track · Fix · Couriers**, each with its own URL.
- **Ship:**
  - Grouped by courier (or zone), each group showing its count and COD total.
  - Columns: order, customer, **zone with an address-quality dot** (ok / "no area" / "city unknown") and an inline **Fix** that edits the address in a sheet, items, COD.
  - "احجز 34 مع [Bosta]" on a group selection.
  - After booking, a toast with "Packing slips" (now) and "Print labels" (when the label API is confirmed).
- **Track:**
  - Dense rows with a mini progress strip (picked up → in transit → out for delivery → delivered, failed attempts as amber ticks).
  - Filters: courier, zone, "stuck > N days". Live `shipments` topic.
  - A row opens the shipment drawer with history inline.
- **Fix:**
  - Failed bookings: reason, inline fix, Retry.
  - **Unmapped statuses grouped by `statusRaw`** ("Bosta: ‘Exception 47’ ×18 → map to …"), applied to all rows with a per-shipment audit. Needs `POST /v1/shipments/status-mapping` `{ connectionId, statusRaw, mapTo }`. It must respect rule 7: terminal statuses need the ops override recorded.
  - Contradicted finals shown side by side.
  - Cancel at courier as an inline step (fixes B7).
- **Couriers:** a scorecard matrix of couriers × zones. Delivered rate as a colour-scaled cell with the number always printed; period as a `Segmented`; zone names come from the courier's zone list and are translated when known.
- **Import statuses** (couriers without an API): `DropZone` → `ImportPreview` (changed / unchanged / error per line) → Apply. This keeps the all-or-nothing rule.

Mobile: cards per shipment; the group header is sticky with "Book all"; the Fix queue as cards with one fix action each.

### 4.8 Returns (`/returns`, new)

- Queues: Coming back · Arrived, to inspect · Inspected today.
- A **scan-first input** at the top: a barcode or tracking scan opens that order's inspection inline.
- Per line: Steppers for restock / damaged / write-off, defaulting to restock. After each save, a line shows the stock and profit change.
- **Exchange** becomes a 3-step sheet:
  1. what comes back (Steppers);
  2. what goes out (the NewOrder `Combobox`, several lines, stock shown);
  3. money: a live credit / collect / refund summary computed on the server with `cashToCollect` semantics. Needs `POST /v1/orders/{id}/exchanges/preview`.
  Then Create.
- API: `GET /v1/returns?queue=` (new list across the store).

### 4.9 Money: payments (`/payments`; `PaymentsScreen.tsx`)

Problems:
- Refund and dispute queues sit above the tabs and duplicate them.
- No COD settlement per courier; totals as KeyValue lists; two unlabelled currency cards on phones.
- Arabic comma (B2); no row actions.

New design:
- **Headline numbers** (StatCards from the metric layer, so they match Reports): To collect (COD with couriers) · Waiting for payment · Received this period · Refunded · In dispute. Each filters the list, and each card is labelled with its currency.
- **Work chips:** Refunds to approve (n) · Disputes due ≤3 days (n) · Transfers to check (n).
- **By courier** settlement view: delivered-not-remitted, remitted, gap, last remittance. Needs `GET /v1/payments/settlements/by-courier`.
- A row opens the order money drawer: ledger lines, Record payment, Refund.
- PaymentMix stays on Today and Reports.

### 4.10 Refunds (`payments/Refunds.tsx`)

- **Request sheet:**
  - Amount chips: full refundable · items only · shipping only · custom.
  - A live "the customer gets X · the order's profit becomes Y" line. Needs `POST /v1/refunds/preview`.
  - Destination as `RadioCards` with icons (original card, wallet, store credit, cash), each with a note ("Instant" / "Needs finance").
  - A stepper Requested → Approved → Sent showing who acts next.
- **Approval queue:** approve inline, bulk approve, reject with reason chips plus free text. Maker-checker stays: the creator can't approve.
- Start a refund from the ticket, the order and the exchange.

### 4.11 Disputes (`payments/Disputes.tsx`, `/disputes/[id]`)

- Sorted by deadline, with a `Countdown` chip (≤3 days amber, overdue red, the number always printed).
- The dispute drawer has an evidence checklist (proof of delivery, confirmation transcript, address, customer history), each item marked found or missing from the order's data. Then "Download pack (PDF)" and "Mark sent" with a reference. Outcome chips: won or lost.

### 4.12 Customers (new, M9: `/customers`, `/customers/[id]`)

- **List:** search by phone or name; columns: name, orders, delivered %, refused, lifetime value, last order, risk.
  - Phone search uses the **existing blind index**: `customers.phone_hash` = HMAC-SHA256 of the E.164 phone with the tenant's pepper (`platform/pii/pii-cipher.ts:21-63`, used by `order-projector.ts:441` and `manual-orders.service.ts`). The query normalizes the input with `@mizan/shared` phone normalization, hashes it with `pii.phoneHash` and matches exactly. No plaintext phone index is ever added; partial-number search is not offered.
  - Name search runs over decrypted names only within the current page of results, or over a tokenized name blind index if M9 needs it (decided in SC-9, recorded in `docs/07`).
- **Detail:** header (masked contact; the reveal is audited); tabs Orders · Conversations (WhatsApp, **[WAITS: Studio]** for the bubble component) · Tickets · Refunds and credit · Notes.
- Store-credit balance; risk shown with its reasons.
- Personal-data rules: masked by default, audited reveal, deletion honoured (`customers/redact`).
- API: `GET /v1/customers`, `GET /v1/customers/{id}` (backed by existing orders, tickets and credit data; schema additions only if M9 needs them).

### 4.13 Tickets (`/tickets`; `TicketsScreen.tsx`, `TicketDetail.tsx`, `NewTicketDialog.tsx`)

- **Split view** at ≥1280 (list 420 + ticket); below that, list then full page.
- **Queue chips:** Mine · Unassigned · Late · Waiting on customer · Waiting on courier · In inspection. They replace the 8 tabs. "Take next" button.
- **Ticket header:** SLA `Countdown` ring; status `Segmented` that saves on click (optimistic); assignee avatar picker with "Me". Each field saves on its own; the global Save goes away.
- **Body tabs:**
  - Thread (notes, the order's WhatsApp conversation, system events);
  - Order (compact summary with the pipeline);
  - Resolve (Refund / Exchange / Re-ship / Close with outcome, each opening the matching sheet with the ticket linked).
- **New ticket:** type as icon chips; reason chips filtered by type; order lookup with a live preview; source chips.
- Icon: `support` instead of `returns`.

### 4.14 Products (`/products`; `Products.tsx`, `ProductDetail.tsx`, `EditProduct.tsx`)

Problems:
- Ownership copy contradicts behaviour (X10). `pricesHint` "put back" is false (`product-projector.ts:39` overwrites).
- No source badges; inline cost entry impossible; a raw textarea import.
- Client-side export capped at 5,000 rows; StatCards repeat the tab counts.
- Edit is in the last column, off-screen on phones.
- Duplicates are visible with no store column (two Shopify stores).
- The cost column is lost below 1024px.

New design:
- **Image-led table** with a **store column (logo + store label)** and a store filter.
- View chips: All · Missing cost · Missing barcode · Low stock · Archived. The 4 StatCards are removed.
- **Missing cost view:** inline-editable cost cells (type, Enter moves to the next row, Arabic digits normalized), batched in one SaveBar ("27 تكلفة اتغيرت · احفظ"). Needs `PATCH /v1/products/costs` (batch) or reuse the import path.
- **Source chip** per product: "[Shopify] synced 3 min ago" or "Mizan".
- **Detail and edit sheet** with three field states (`SourceField`, §10): locked / synced both ways / Mizan only. Correct the copy in `products.ownership`, `products.editor.storeFields` and `pricesHint`.
- One button, "Edit". "Edit in Shopify ↗" moves into the ⋯ menu.
- **Import:** `DropZone` → preview of "will change" (old → new) with invalid rows marked inline; Apply is disabled until there are zero errors.
- **Export:** a server stream endpoint (`GET /v1/products/export?format=csv|xlsx`), like Reports.

Mobile card: image, title, price, a cost pill or "Add cost" button, stock.

### 4.15 Stock (`/stock`; `StockScreen.tsx`) and pick lists (`/stock/picklists`, now under Fulfil)

- **Empty honesty:** when nothing is tracked ("0 of 51"), show one guided empty state, "ابدأ أول جرد", instead of a 3,844px table of placeholders.
- **Chips:** All · Not counted · Low · Out · Waiting for stock.
- Rows: image, title, SKU, **bin**, and a stacked bar of reserved and available against on hand. A negative store stock gets a warning chip.
- The "Shopify shows" cell is locked, with the tooltip "Mizan sends its count here when 'Send counts to Shopify' is on". The toggle lives on the Shopify node.
- **Count mode:** a full-screen sheet. Scan or type a barcode → jump to the row → type the counted quantity → next. It ends with a difference summary, then Apply.
- The item drawer has tabs Movements | Settings (threshold, **bin**: the UI for `stock.service.ts:159,185`) with one SaveBar (fixes the two-save dialog).
- Pick lists: the back button uses history; the slip barcode is Code128.

Mobile: card with image, title, available / on hand, bin.

### 4.16 Purchasing (`/purchasing*`)

- **Landing:** a "Needs reorder" strip (top 5 by lowest cover, one tap "Draft POs"), then the PO list with received progress. The header keeps one primary action (New PO); Suppliers and Reorder go in the sub-nav.
- **Reorder rows:** a cover-days bar against lead time (red where cover is shorter than lead time), Steppers that snap to pack size, a subtotal per supplier in the supplier's currency.
- **Supplier:** currency `Combobox` of ISO codes (no free text, `SuppliersScreen.tsx:112`); lead time as a Stepper.
- Settings → Purchasing: the reorder maths card with a live example ("an item selling 4/day with 7 days lead → reorder at 40"). The approval amount moves to Settings → Approvals with a `CurrencyInput`.

### 4.17 Profit (`/profit`; `ProfitBreakdown.tsx`)

- Dimension `Segmented`, `PeriodPicker`, and a Columns menu (remembered locally, in try/catch).
- `DataTable` with sort and a sticky first column. Rows expand into a mini waterfall and link to `/orders?productId=` or `?courier=`. Product rows have images; courier and store rows have logos.
- Missing costs show a "ناقص" chip, never "0.00".
- Export ▾ (CSV/Excel) uses the server export, so the numbers match the screen.

### 4.18 Ads and ROAS (`/profit/ads`) and Ad spend (`/profit/spend`)

- 3 tabs:
  - Overview: true vs reported ROAS as paired bars, plus a one-line gap explanation;
  - Sources;
  - Campaigns (level picker inside).
- Remove the stale `adsRoas.perCampaignSoon`; one `PlatformName` with a logo; delete the duplicate namespaces (`adsRoas.platform`, `sources.platform`, `adSpend.platform`).
- Ad spend: the CSV import becomes `DropZone` + a column-mapping preview with inline row errors. It also opens from the Ads nodes on the map.
- Backfill progress is shown as a ring.

### 4.19 Reports (`/reports`)

- Dashboards as a list at the inline start (desktop) or chips (phone). The header has `PeriodPicker` and Export ▾ (Excel, CSV, later "Send every Monday").
- Tiles show value and label with an (i) that opens the definition popover. The metric dictionary is a searchable side sheet reachable from any (i) on any screen.
- Charts: real width, Y min/max labels, a pointer scrubber, week buckets past 45 points, bars for sparse data.
- Dates through Intl (no raw ISO); provisional treatment for missing costs, the same as Today.

### 4.20 Automations (`/automations`, `/automations/[id]`)

- **Canvas:** a **When → If → Then** node chain, vertical on phones and horizontal on desktop, in the FlowMap node style.
  - Each node is a chip with an icon; tapping opens its config sheet with fields generated from the `/v1/catalog` schema (no more `KNOWN_TRIGGERS` / `KNOWN_ACTIONS`, `Automations.tsx:26-29`).
  - Installed automations become editable.
- **Recipe gallery:** illustrated cards with a mini node diagram and "Install (off)", which opens the canvas.
- **Run log drawer:** filter chips Failed · Skipped · Succeeded, linked to orders, with **Run again** on failed runs (§8.3).
- **Dry run** in translated sentences: "إجمالي الأوردر ≥ 2,000 ج.م · الفعلي 1,150 · ✗".
- **Paused automations:** a "Paused because …" chip with Resume and See why.
- API: `PUT /v1/automations/{id}` (graph edit), `POST /v1/automations/runs/{id}/rerun`.

### 4.21 Settings pages

| Page | Redesign |
|---|---|
| Settings hub | Desktop: no card grid; land on Store with the side list. Phones: a grouped list with chevrons. Icons: Store `store`, Settings `settings` (fixes the clash). |
| Store profile | Locked channel fields (§10): logo, square logo, colour, name, primary and myshopify domains, country, currency (warning on mismatch with Shopify), time zone (Shopify's suggested, with a "Differs from Shopify" badge), slug relabelled "عنوان المتجر على ميزان". "Follow the channel's name" switch (Default on). |
| Team | Member cards (avatar, name, contact, role pill). A role sheet with `RadioCards` listing key permissions (from `@mizan/shared` permissions). Invite in a side sheet with "Invite another". Pending invites inline with an expiry countdown. Phone examples wrapped one by one. |
| Roles | Read-only matrix of roles × permissions. |
| Costs and FX | One draft and **one SaveBar** ("3 changes take effect from today"). Sections: Per order · Couriers (only *connected* couriers with logos; zones picked from the courier's list) · Monthly fixed · FX (table with sparklines, "1 USD = 49.20 EGP" shown rounded to 4 significant digits **for display only**; storage keeps the full stored precision of the daily rate and every computation uses it (rule 8); manual override per day) · Recalculate (server job with a progress bar, no client loop). "End rule" asks for confirmation, then an Undo toast. |
| Payment methods and fees | Methods with logos; `payment_fee_pct` per enabled method; COD conversion with a pay-link message preview. |
| Approvals | Refund and PO approval amounts with `CurrencyInput` (code prefix) and live examples ("A 1,200 EGP refund needs approval by owner, admin or finance; not by whoever created it"). |
| Inventory | Thresholds and defaults; the push-to-store switch is shown with a link "Lives on the Shopify node". |
| Plan and billing | §7.9. |
| Audit log | Timeline grouped by day; filters by family (complete list, from one shared catalogue with ActivityLog), actor and date range; each row expands into a field diff (PII stays masked); entity links; **entity types shown as translated labels (`audit.entity.*`), never the raw `entity.type` code** (screens-insight 9.8), with a generic fallback; actor badges (Mizan staff / System / App); export. |
| Privacy, Orders, Offers, After confirmation | Keep, inside `Page width="form"`. Offers and After confirmation are hands-off. |
| My account (new `/account`) | Profile, two-step, active sessions, language, theme, notification preferences per channel. |

### 4.22 Notifications

- A side sheet on desktop, a full sheet on phones; tabs All / Needs action.
- Rows: type icon or partner logo, one line, time, link.
- Mark read per row when seen (IntersectionObserver), plus "Mark all read". Opening the panel no longer marks everything read (`NotificationBell.tsx:95`).
- A full `/notifications` page sharing rows with Today's activity.
- API: structured `{ kind, params, href }` payloads instead of pipe strings (`NotificationBell.tsx:65-91`), with links for tickets, refunds, payments, POs, disputes and connections.

### 4.23 Welcome, sign-in, two-step, invitations, legal, print, errors, gallery

- **Welcome** becomes the start of onboarding (§6). It no longer asks for a store name before the channel; the name follows from the connection, and a free-text name is offered only for "selling by hand". It uses the same ink look as the landing so the first impression matches. Tap targets ≥44; a custom 24px checkbox.
- **Sign-in and two-step:** the same visual shell; signup reads `plan` and `billing` from the landing URL (§7).
- **Auth flow (AU-1, built).** "A focus card on a living stage":
  - **Frame.** `(auth)` route group with one persistent layout (`components/auth/Frame.tsx`): skip link, the Brandita floating top bar (wordmark, language link, theme menu; "Need help?" and the opposite of the card's mode from tablets up), the card, the ink stage, the footer, `#sms-verifier` and the polite `#auth-live` as direct children. URLs are unchanged; moving between sign-in, welcome and two-step never remounts the frame.
  - **Stage.** Desktop: an ink island beside the form (scale mark, headline, a mini connections map that later hands off to onboarding's map, an "Example" outcomes ticker, a pause button). Tablet: a 220px band the card overlaps. Phone: a 72px strip, hidden while the keyboard is open and on landscape phones. Server-rendered as its final frame; the animator chunk loads on idle and never under reduced motion or Save-Data. Scenes: sign-in, sign-up (trial pill), Shopify (its node waiting), invitation, welcome, secure, outage, staff.
  - **Card.** One step at a time from a pure reducer (`lib/auth/flow.ts`): email and password on one step, or a mobile number then its code; the SMS second step with a resend; reset → "Check your email"; company SSO; done with the success wipe. `StepHost` keeps the outgoing step (inert) for its exit, moves focus at 0ms and FLIPs the card surface.
  - **Kit.** Shared with the back office: `@mizan/design-system/auth.css`, `auth-motion` (WAAPI, interruptible, durations and easings as `--mz-dur-*`/`--mz-ease-*` custom properties with local fallbacks), `auth-code` and `auth/react` (StepHost, TextField, PasswordField with "Show"/"Hide", CodeField with one real input over six boxes and auto-submit once per value, ResendTimer 60/120/300s, PrimaryCta key button, FormAlert, StepProgress, StrengthMeter, ScaleMark, SuccessMark, CardSkeleton). Every waiting, sending and confirmed moment draws through one slot, `AuthProgress kind="loading|sending|signingIn|confirmed"`, on the Brand 2.0 loaders by the catalogue's meanings (`WAIT_MOTION` in `@mizan/shared/motion`): loading = the pair, sending a code or a link and signing in = the drop (mono, in the key button), confirmed = `DoneState` (MERGE, then the red DROPs once). Red once per view on the auth screens: the header wordmark is full colour until something holds the red (DoneState, the trial chip's dot as a `RedSwatch`, the outage dot), then mono; the stage's ambient light is paper, never red.
  - **Params.** Allow-listed on the server and mapped to enums (`lib/auth/params.ts`): `next` (safeNext, now also refusing backslashes and control characters, decoded too), `mode`, `plan` (`enterprise` → Scale), `billing`, `reason`, `enrolled`, `invite` (strict uuid). The language link re-serialises only these and asks first during a code step. The sign-up intent (plan, interval) stays in this tab (`sessionStorage`, 24h, re-validated) and the trial chip shows "7-day trial of Growth/Scale". **Hand-off:** `POST /v1/tenants` sends `plan`/`interval` once `claude/rd-e12-trial` adds them to `CreateTenant` (marked in `Welcome.tsx`).
  - **States.** Reason banners (expired, reset, verified, disabled, invitation, Shopify with the shop name only when it is a real `*.myshopify.com`), offline banner with the CTA held, outage inside the card with backoff, "too many attempts" held 30s or by `Retry-After`, in-app browsers and blocked storage with "Copy link". Every Firebase code maps to a message and a place (a field or the form's alert); unknown → generic.
  - **Motion.** CSS + WAAPI only; transform and opacity; no shake; reduced motion is a full design (120ms crossfades, still stage, no wipe). The back office's staff sign-in uses the same kit and frame (`StaffFrame`, ink stage with the scale only), keeps its e2e labels and now returns to `?next` (a back-office path only).
  - **Later phases:** AU-2 (Welcome redesign, `addEmail`, session `expired` and `lost`), AU-3 (two-step progress, country picker and in-place re-auth), AU-4 (invitation status by id), AU-6 (branded `/auth/action`).
- **Print:** Back uses history; packing slips get Code128 barcodes for the order and tracking numbers; a "Labels" option is added when the courier label API lands.
- **Errors:**
  - `(app)/error.tsx`: in the frame, with retry and "back to Today".
  - `(app)/not-found.tsx`, `[locale]/not-found.tsx`, `global-error.tsx`.
  - `loading.tsx` only for server work.
- **UI gallery (`/[locale]/ui`):** wrapped in `GlassRoot` and rendered from `packages/ui` components, so it is the production look. Every new piece gets an entry at 3 widths × 2 languages × 2 themes. This is the visual contract.

### 4.24 Admin and customer-service panel (`apps/admin`, every page)

All pages use the shared `AppTopBar`, `Page`/`PageHeader`, `DataTable` v2 and `RecordDrawer`. Staff copy is AR/EN like the app. The CS panel is a route group inside admin by default (owner decision D19), with role-scoped nav for `support`.

| Page | Redesign |
|---|---|
| Stores `/stores` | Search by name, domain, myshopify, owner email or phone (exact, hashed), order id; **health chips** per row (map health worst state, open incidents, dead jobs, plan/trial status, support access active); queue chips: Needs attention · Trial ending ≤2 days · Past due · Suspended; row opens store-360 |
| Store-360 `/stores/[id]` | Tabs as §8.5 (Overview, Events, Integrations map read-only, Cases, Notes, Access, Team, Usage & billing, Audit); suspend/reactivate and plan actions move into a ⋯ menu with reason sheets |
| Users `/users` and user detail | Search by email/phone; detail drawer: stores and roles, sign-in methods, two-step state, last sign-in, disable sign-in (reason required), sessions revoke; PII masked with an audited reveal |
| Flags `/flags` | A **matrix**: flags (rows) × scope (global + per-store overrides); search a store to add an override column; each cell is a tri-state (inherit / on / off) with an expiry; changes go through a review sheet listing affected stores; rollout flags from §11.0b (`shell_v2`, `connections_map`, `onboarding_v2`, `entitlements`) live here |
| Announcements `/announcements` | Composer with AR and EN side by side, audience (all, plan, country, store list), schedule window, severity; a **live preview** of the BannerSlot at phone and desktop widths in both languages |
| Staff `/staff` | Member cards with role pills; a roles × permissions matrix generated from the platform permission list; invite and disable with reason; second-step status |
| Support access `/access` | Active grants with countdown, reason, linked case; request flow pre-filled from a case; ends automatically on case resolve |
| Staff trail `/trail` | Timeline by day with filters (actor, action family, store); each row links to the target and the case |
| Event Center, Incidents, Cases, Billing | §8.5 and §7.10 |

### 4.25 Ops app (`apps/ops`, Flutter)

The ops app is part of "the whole system". It keeps its offline-first engine (drift queue + exactly-once sync to `/v1/ops/sync`, chaos-tested) unchanged; only the look and the offline UX change.

- **Tokens:** `lib/theme/mizan_tokens.dart` regenerated from DS-1 (2026-10 palette, motion durations); `test/design_system_copy_test.dart` updated in the same PR (OP-1).
- **Navigation:** a bottom dock matching the web dock (Count · Pick · Receive · Queue), 64px + safe area, labels from ARB files (`lib/l10n/app_ar.arb`, `app_en.arb`), Arabic default.
- **Offline status bar** (OP-2), always visible at the top: "Offline · 12 waiting" / "Syncing 4…" / "All sent · 14:32"; tapping opens the queue (`lib/app/queue_screen.dart`) with per-op state; **conflicts and server rejects** open a sheet per item in merchant language with Retry / Discard (reason) / "Ask the office", and each reject is also recorded server-side as an `ops_device` event (§8.2).
- **Scan screens** (`pick/pack_screen.dart`, `receive/receive_screen.dart`, count in `app/home_screen.dart`) (OP-3): 56px+ targets, one primary action per screen at thumb height, big Western-digit quantities, haptic feedback on scan success (light) and wrong item (heavy + red point + sound option), the camera view with a clear scan frame, AR/EN.
- **Sign-in (E8-4b)** uses the same visual shell as the web sign-in.
- **Brand 2.0 motion (✅ BR-1):** the queue, count, pick and receiving screens play events from the shared catalogue (§2.6): transfer while syncing, pair while refreshing, `FillBar` for scanned of wanted, `VesselsCount` per receiving line, a tip glyph with the heavy buzz on a wrong item, toasts with glyphs for a saved count, a packed box and a received delivery; reduced motion shows still frames.
- Tests: widget tests per screen in AR and EN, the existing sync and flow tests stay green.

---

## 5. Integration map (`/connections`)

### 5.1 Telemetry first

The map is only as honest as its data. These fixes come before the UI (milestones CN-1 and FX-3):

| Fix | Change |
|---|---|
| Breaker and budget state are per process; the API reads its own idle engines (`integrations-admin.controller.ts:102-113`, rebuilt every 10 min) | The worker's `EngineJobRunner` upserts **`connection_runtime`** (tenant_id, connection_id PK, breaker_state, breaker_failures, retry_at, budget jsonb, last_ok_at, last_error_at, last_error_kind, updated_at), throttled to 1 write per 5s per connection, with RLS. |
| No throughput history | **`connection_activity`** (tenant_id, connection_id, stream, direction, minute, ok, failed; PK on the first five columns). **Never written on the webhook fast path:** each process aggregates counts in memory per (connection, stream, direction, minute) and flushes every 5–10s with one batched `INSERT … ON CONFLICT DO UPDATE ok = ok + excluded.ok`, so busy connections get no hot-row contention inside the 200-fast path (rule 3). Inbound counts are derived by the worker from `event_intake` rows; outbound from job done/dead in the job runner; WhatsApp sends from the same in-memory counter. A crash loses at most 10s of counts (display only; `event_intake` and `mz_outbox` stay the source of truth). Kept 7 days. |
| Drift lives in memory per process | **`drift_issues`** (connection_id, connector, entity, kind, field, detail, sealed sample, count, first_at, last_at, resolved_at), upserted from `DriftMonitor.onNew`; counts flushed every minute. |
| Disconnect deletes queued jobs (`connection-lifecycle.ts:49`) | New `mz_outbox.status = 'dropped'` (widen the CHECK at `0001_core.sql:517`), `last_error = 'connection_disconnected'`. After reconnect: "Resend N dropped jobs". |
| Engine events go to a debug log (`integrations.module.ts:17`) | Durable `EngineEventSink` that maps them to domain events (`integration.job_dead`, `integration.drift_detected`, `integration.webhook_rejected`, `integration.breaker_opened` / `_closed`, `connection.needs_attention`) and `ops_timeline` rows (§8). Register them in `docs/13`. |
| Dead letters are sorted in memory and keyed by provider string (`:124-133`); `/sync` counts are tenant-wide (`:154-163`) | SQL by `connection_id`, cursor-paginated, returning `connectionId`; counts grouped per connection. |
| `GET /v1/connections` lives in the Bosta controller | Move it to a `ConnectionsController`. |
| The health route returns `z.unknown()` and the web casts it (integrations-onboarding 0.6) | Typed zod schema for the map snapshot; the old health route stays only as a compatibility shim **with a removal date** (one release after CN-3, tracked in CLN-1) |
| A store whose connection is not ready is silently skipped (`NotConnectedError`, J3) | Write an `ops_timeline` row (`cause_code = connection_waiting`) and expose a `waiting` health state (shown as `setup` with "مستني الربط يكمل") |

### 5.2 Layout

- **Hub:** the Mizan monogram (`public/brand/mizan-monogram.svg` / `-on-dark`) in a 96px tile with the existing `ld-orbit` halo. It shows the hub state (worker liveness, guardian "last checked", where more than 20 min is late).
- **Sectors** are placed by reading direction (angles computed from `dir`, never hard-coded left or right):

| Sector | Position | Live nodes | Placeholders (dashed, monochrome, last in tab order, at most 2 + "+N more") |
|---|---|---|---|
| Sales channels | inline-start arc | Shopify (one node per store), WooCommerce | EasyOrders, Salla, Zid, Noon, Amazon, POS |
| Couriers | inline-end arc | Bosta, couriers by hand (one per name) | J&T, Mylerz, Aramex, SMSA, SPL, Aymakan |
| Messaging | top | WhatsApp Cloud (per number) | SMS |
| Payments | bottom-start | **"Cash on delivery via couriers"** pseudo-node (always present when a courier is connected), fed by the courier `cash` streams: to collect, collected, remitted, gap; Paymob when E14-2c lands | Kashier, Fawry, Tabby, Tamara, InstaPay |
| Ads | bottom-end | "Manual (CSV)" node with last import and spend in the window | Meta, TikTok, Snap, Google |
| Tax | bottom, KSA only | — | ZATCA |

**Launch content per sector** (so no sector looks dead at go-live, `docs/15` scope = Shopify, Bosta, COD-first):

| Sector | At launch | Later |
|---|---|---|
| Sales channels | Shopify node(s) live; Woo live when connected; "Selling by hand" node when manual orders exist | Marketplaces as they ship |
| Couriers | Bosta live; manual couriers | More APIs |
| Messaging | WhatsApp live when connected, else a `setup` node with "+ اربط" | SMS |
| Payments | COD-via-couriers pseudo-node (live), "Bank transfer / InstaPay recorded by the team" pseudo-node fed by ledger entries | Paymob node (E14-2c) |
| Ads | Manual (CSV) node | Platform APIs (approval-gated) |

- More than 4 nodes of one kind in a sector fold into a stacked group node with a count; it expands in place.
- **COD cash** is a `cash` stream on the courier edge (courier → Mizan), and the Payments pseudo-node aggregates it; a pseudo-node opens a drawer with the by-courier settlement view (§4.9) instead of connection settings.

### 5.3 Edges and flows

- Each edge is an SVG cubic from the node to the hub, with **two lanes**: in (toward the hub, outer lane) and out (inner lane). An arrowhead glyph sits at mid-lane, so direction never depends on motion or colour.
- **Path strings are generated per direction:** the layout computes node angles from `dir`, then builds the cubic in physical SVG coordinates for that direction (SVG has no logical coordinates). A unit test snapshots the generated paths for both `ltr` and `rtl`.
- **Particles** are 4px HTML `<i>` dots in the HTML layer, animated with **WAAPI `transform: translate(x, y)` keyframes**. Each lane path is sampled once per layout with `getPointAtLength` into about 24 stops; the keyframes are reused by every particle on that lane. This stays compositor-only (CSS `offset-distance` animations may run on the main thread in Chromium **[CONFIRM]**, so they are not used). No JS loop per frame.
  - Count per lane: `min(6, ceil(log2(perMin + 1)))` on fine pointers, `min(2, …)` on `(pointer:coarse)`; 0 when idle. Global caps: 60 fine, 20 coarse.
  - Duration: 2.4s at healthy lag, rising linearly to 6s as `lagS` approaches the stream threshold.
  - Spacing through WAAPI `delay` / `iterationStart`.
  - When data changes, adjust `playbackRate` (duration) and add/remove particles with a 200ms opacity crossfade instead of restarting.
  - Linear easing on the path. Entrances and state changes use `--mz-ease`.
- **Streams per edge:**

| Edge | In (to Mizan) | Out (from Mizan) |
|---|---|---|
| Shopify / Woo | orders, products, webhooks | fulfillments, tags and status, stock, edits |
| Bosta | tracking statuses, cash | shipments, cancels |
| Courier by hand | statuses (CSV) | — |
| WhatsApp | replies, delivery statuses | messages |
| Paymob | payments | payment links, refunds |
| Ads | spend | (later) conversions |

- **States** (server-derived `health`; the web never re-derives it):

| State | Rule (server) | Edge | Particles | Node |
|---|---|---|---|---|
| `ok` / flowing | none of the below | solid `--line-strong` | ink or bone | small success dot |
| `idle` | no traffic for 15 min, healthy | solid `--line` | none; "آخر حركة من 12 دقيقة" on hover or focus | — |
| `syncing` | backfill running | solid | denser, in lane only | progress ring with "340 orders · 52 products" |
| `degraded` | dead letters needing a person, open drift, or `lagS` above the stream threshold | solid with a warning tint | normal | warning chip with a count, e.g. "3 محتاجينك" |
| `paused` | breaker open with a retry pending | dashed | stop at a mid-edge gate glyph with a countdown to `retryAt` | warning chip "بيستنى · 02:14" |
| `down` | disconnected, `auth` / `permission`, breaker open more than 5 min, or a run of signature failures | dashed `--danger` | none | **the one red point**: pulsing red dot, error icon and a short reason ("المفتاح اترفض"), primary fix |
| `manual` | provider without an API | dotted | one particle only when a person acts | "يدوي" |
| `setup` / `soon` | placeholder | dashed outline | none | "+ اربط" / "قريب" |

  Some partner marks are red (Aramex, J&T, maybe Bosta). An error never relies on colour: always icon + text + a dashed edge.
- **Motion:**
  - a new node scales .92 → 1 and fades over `slow` with `--mz-ease`; its edge draws in with `.mz-draw` (stroke-dashoffset);
  - a state change crossfades over 200ms;
  - entering `down` shakes once (4px, one cycle);
  - hover or focus pauses particles on that edge.

### 5.4 Interaction

- Each node is a real `<button>` in an HTML layer over an `aria-hidden` SVG.
- Hover or focus shows a card: name, status, last in and out, a 15-minute sparkline (`last15`) and the primary fix.
- Touch: first tap opens the card, second tap opens the drawer; a long press goes straight to the drawer.
- **Click opens the drawer as a URL:** `/connections/[connectionId]`, built with an intercepting route `(.)[connectionId]` in an `@drawer` slot. It is shareable, Back closes it, support can deep-link to it, and opened directly it renders as a full page. Placeholders open `/connections/add?slug=`.
- **Toolbar:**
  - a summary sentence ("كل حاجة شغالة" / "2 ربط محتاجينك");
  - Map / List toggle (stored locally, in try/catch);
  - window: live / 1h / 24h;
  - "Check all now";
  - "+ Connect" (the context key).

### 5.5 Node drawer: every setting for one integration

Desktop: inline-end side sheet, 480px. Phone: bottom sheet with snaps at 50% and 100%, drag to dismiss, safe area. Focus is trapped inside and returned to the node on close.

**Header:**
- partner logo;
- **name from the channel, locked** (lock icon, "من Shopify", "غيّره من Shopify ↗" deep link to `https://admin.shopify.com/store/<handle>/settings/general`);
- "Label in Mizan" (editable nickname, `RenameConnectionSchema`) shown separately underneath;
- account (`<bdi dir="ltr">`, mono);
- status chip and reason;
- **one primary fix**, chosen from `actions[]`: "وافق على الصلاحيات الجديدة في Shopify", "حط مفتاح Bosta جديد", "اربط تاني".

**Tabs:**
1. **Overview:**
   - both flows with per-stream counters (last hour / 24h), lag, last webhook, guardian last check;
   - backfill progress with Retry (`POST /v1/connections/{id}/import`);
   - webhooks registered vs required;
   - the event timeline (last 20).
2. **Settings,** by provider:
   - **Shopify:** "What Mizan writes to Shopify" (`progressEvents`, `markPaidOnDelivery`, `tagReturned`, `tagLost`, `createManualOrders`, moved from `StoreSyncScreen.tsx`, with a preview of the tags and timeline entries Shopify will show); "Send counts to Shopify" (moved from Inventory); granted and missing scopes; locations; locked fields (§10).
   - **WooCommerce:** the applicable toggles, rotate keys, webhook health ("disabled by Woo, turned back on at hh:mm"), site name and URL locked.
   - **Bosta:** replace key; pickup location and defaults; learned city aliases (list + delete); learned status codes (read-only); tracking-link setting; **zones and rates** (moved from Costs, rate editable per zone, zone names locked).
   - **Courier by hand:** display name, tracking-URL template, CSV status import, last import.
   - **WhatsApp:** display number, verified name, quality rating and messaging tier (locked, "من Meta"; a new engine read of the phone-number profile; the field names `display_phone_number`, `verified_name`, `quality_rating`, `messaging_limit_tier` are read through `Resolver` with ranked candidate paths and are **[CONFIRM]** against the pinned Graph version, rule 2), template approval states (read-only), and a link "خصّص الرسايل" to `/settings/confirmation`.
     - **CN-4b [WAITS: Studio/Template]:** the drawer embeds the Studio's read-only `StudioSummary` (flow steps, chosen first-message template and its approval state, fallback template in use, reminders) with "Edit in Studio" buttons that deep-link to the exact Studio section (`/settings/confirmation#<section>`). So clicking the WhatsApp node shows all its settings, while editing stays in the Studio. The `StudioSummary` export is agreed with the branch owners now (§0).
   - **Paymob (after E14-2c):** keys, region, integration ids per method.
   - **Ads (CSV):** import, last import, request-access CTA.
3. **Activity:** the job log and inbound receipts (`GET /v1/connections/{id}/activity?status=&kind=&direction=&cursor=`) with filters and a payload viewer (scrubbed, mono, LTR, allowlisted keys). This is the merchant face of the Event Center (§8.6).
4. **Problems:**
   - dead letters grouped by cause with Replay, Replay all and Dismiss;
   - the city resolver (`ResolveCityDialog` from `EngineHealth.tsx:100`);
   - drift issues with the paths tried;
   - dropped jobs with Resend.
   Copy is in merchant language; raw text sits behind "التفاصيل".
5. **Danger zone:** disconnect with type-to-confirm (moved as-is from `ConnectionManage.tsx:62-94`), styled destructive and placed apart from rename.

### 5.6 API additions

All under `@Can("connections.read")` or `connections.manage`, with zod and `@ApiJson…`, a regenerated `openapi.json` and web and admin types.

| # | Endpoint | Purpose |
|---|---|---|
| 1 | `GET /v1/integrations/map` | One snapshot: `{ generatedAt, pollAfterMs, hub: {state, worker:{lastTickAt}, guardian:{checkedAt, late}}, nodes:[{ id, kind, provider, logo, name:{value, source:"channel"\|"team"\|"mizan", locked}, account, status, reason, health, breaker, budget, lastInAt, lastOutAt, lastOkAt, lastErrorAt, lagS, backfill, queue:{pending,running}, dead:{retrying,needsYou,nextRetryAt}, drift:{open,lastAt}, webhooks:{required,registered,lastReceivedAt,rejected5m}, actions[], detailHref }], edges:[{ nodeId, flows:[{direction, stream, perMin, last15[], errors15m, state}] }] }`. Reads `connection_runtime`, `connection_activity`, `mz_outbox`, `mz_inbound_events`, `drift_issues` and `mz_records`. |
| 2 | Live topic `connections` on `GET /v1/live` (§4.0) | `snapshot` event, then `delta` events every 5s while visible, plus immediate `state` events on a breaker change, a job going dead, drift or a signature run. Fallback: poll #1 every 10s. |
| 3 | `GET /v1/connections/{id}` | Full detail for the drawer (config without secrets, scopes, webhooks, sync options, last 20 events) **and the learned items the drawer lists**: Bosta pickup locations (`{id, name, default}`), learned city aliases (`{raw, cityId, learnedAt}`, deletable via `DELETE /v1/connections/{id}/city-aliases/{raw}`), learned status codes (read-only), zones with Mizan rates. |
| 4 | `GET /v1/connections/{id}/activity` | Job log plus inbound receipts, scrubbed with `scrubText`. |
| 5 | `POST /v1/connections/{id}/replay` `{ filter?, ids? }` and `POST /v1/connections/{id}/resend-dropped` | Bulk, audited, idempotent; through the recovery registry (§8.3). |
| 6 | `POST /v1/connections/{id}/check` | Enqueues `bosta.checkAccess`, the WhatsApp check or `shopify.syncWebhooks`. Never calls a provider inside the request (rule 3). |
| 7 | `POST /v1/connections/{id}/reconnect` | `{ authorizeUrl }` or `{ needsKey: true }`. |
| 8 | `GET /v1/integrations/catalog?country=` | Every provider: `{ slug, kind, nameAr, nameEn, markets, availability: connect\|manual\|coming_soon\|request, auth: oauth\|key\|embedded_signup\|csv, logo, docsHref }`. Source is a `packages/shared` constant. It drives the placeholders, onboarding tiles and i18n names. |
| 9 | `POST /v1/integrations/requests` `{ slug }` | Records demand (folds in onboarding's `channel: easyorders\|other`). |
| 10 | `GET /v1/platform/stores/{id}/integrations/map` | The same snapshot for staff (read-only), through support access rules. |
| 11 | `PATCH /v1/connections/{id}/sync-options` | Replaces the store-sync endpoints the old screen used (keep the old route as a shim for one release). |

### 5.7 Accessibility and non-visual equivalent

- **List view** is a real `<table>`: Integration | Status | In (last hour) | Out (last hour) | Last sync | Needs you | Action. It is also the default under reduced motion if the user picked it.
- Node buttons carry full sentences: "Shopify، nile-abayas.myshopify.com: شغال، 12 أوردر دخلوا و9 تجهيزات طلعت في آخر ساعة، مفيش حاجة محتاجاك".
- One `aria-live="polite"` region announces only transitions into or out of error and breaker changes, throttled to 1 per 10s.
- Keyboard order: hub, then sectors in reading order; arrow keys move within a sector; Enter opens; Esc closes the drawer.
- **Reduced motion:** no particles, pulse or shake. Lanes show static double arrows plus text ("+12 أوردر / ساعة"). Entrances fade only.
- Contrast for node text and chips is covered by the design-system WCAG tests.
- **Performance:**
  - particles at most 6 × 2 × N, capped at 60 visible (2 × 2 × N, capped at 20, on coarse pointers); all paused on `document.hidden` and when the map is off-screen (IntersectionObserver);
  - the stream stops on hidden tabs;
  - paths are computed once per layout with `ResizeObserver`;
  - SVG and HTML only (no canvas), themed by tokens.

### 5.8 Mobile and tablet

- **<640px, "spine":**
  - the hub is a sticky compact header with the summary;
  - below it, one section per sector (header shows the worst state and a count, e.g. "شركات الشحن · 1 محتاجك");
  - node rows have a short vertical connector line on the inline-start side; particles run vertically (up = in, down = out) with a permanent arrow glyph;
  - rows are 56px; the drawer is a bottom sheet.
- **640–1023:** radial layout with sectors folded into 5 cluster bubbles; tapping a cluster expands it in place.
- **≥1024:** full radial.

### 5.9 Real logos

**Store:**
- `packages/design-system/logos/partners/<slug>.svg` and `<slug>-on-dark.svg`.
- `partners.json`: `{ slug, nameEn, nameAr, source: "simple-icons@<exact ver>" | "press-kit", sourceUrl, guideUrl, license, retrievedAt, allowedVariants: ("color"|"black"|"white"|"on-dark")[], minPx, clearSpace, hasDark, nominativeOnly, monogram? }`. `allowedVariants`, `minPx` and `guideUrl` are filled from each brand's official guide **before** that logo ships (DS-3 acceptance); an entry without them renders as a monogram.
- `<PartnerLogo slug size variant="color|mono">` in `packages/ui`: `<img>` for multicolour, `alt=""` next to visible text, otherwise the brand name. `variant="mono"` picks the brand-provided one-colour file (black on light, white on dark) **only if `allowedVariants` lists it**, otherwise falls back to colour on a neutral tile.

**Sources:**
- Simple Icons (CC0 paths; trademarks still belong to each brand): **copy the SVG paths in; do not add the package**. Record the exact version (pick a release at least 2 weeks old). A script (`packages/design-system/scripts/check-partner-slugs.mjs`) checks every `simple-icons` entry against that version's pinned `data/simple-icons.json`; slugs removed at a brand's request (or renamed, e.g. the Woo rebrand) are recorded as `monogram: true` with a note.
  - Candidates (each verified by the script, none assumed): shopify, woocommerce, wordpress, whatsapp, meta, facebook, instagram, google, googleads, tiktok, snapchat, amazon, applepay, googlepay, visa, mastercard, paypal, stripe, dhl, fedex, ups.
- Press kits, with written permission **[CONFIRM per partner]**: Bosta, J&T, Mylerz, Aramex (check simple-icons first), SMSA, SPL, Aymakan, R2S, Paymob, Kashier, Fawry, Geidea, Moyasar, Tap, HyperPay, valU, Tabby and Tamara (their merchant badge files, as-is), Salla, Zid, YouCan, EasyOrders, LightFunnels, Noon, Jumia, Checkout.com, InstaPay, Vodafone Cash. ZATCA shows as text unless approved.
- Use official marks only: never redraw, trace or approximate a mark, and no generic icon-set brand glyphs. A missing mark shows a neutral **monogram tile** (initial on `--surface`).

**Usage rules:**
- Never recolour, crop, rotate or animate the mark; animate the tile. "Mono" means the brand's own one-colour file in black or white where its guide allows it, **never** a `currentColor` mask or a tint to `--mute`.
- Keep clear space (default: the mark's cap height) and each guide's minimum size (16–24px).
- Dark theme: the brand's negative variant, otherwise the mark on a light tile.
- Nominative wording only ("اربط متجرك على Shopify"; "Works with Shopify" only once allowed).
- No partner badges without approval.

**Colour policy (owner decision D8):** default is **full colour on neutral tiles** on the map, drawer, onboarding and catalogue, where recognition matters, and the **brand-provided black/white one-colour variant** in dense tables, chips and the landing (only for brands whose guide allows it; others stay in colour on a small neutral tile), with colour on hover and focus.

**Test** (design system): every catalogue slug has a manifest entry or `monogram: true`; every file has a `source`; every non-monogram entry has `guideUrl`, `allowedVariants` and `minPx`; every `mono` file exists only if listed in `allowedVariants`; SVGs are scrubbed (no scripts, no external refs, no `<foreignObject>`).

---

## 6. Onboarding: setup builds the map

**Route:** a new `(focus)` route group (`app/[locale]/(focus)/onboarding`): no hubs, no dock, no banners except billing and support, one exit "كمّل بعدين" back to Today. `?step=` deep links keep working. The existing API stays (`GET/PATCH /v1/onboarding`, background import polled every 3s, skip and undo, `timeToFirstValueS`).

**Flow:** the canvas is the FlowMap, small, with only the hub and ghost nodes.

1. **Welcome** (about 10s).
   - One line: "اربط متجرك وشوف ربح أول أوردر بجد في حوالي 10 دقايق".
   - A trial chip ("تجربة Growth · فاضل 7 أيام").
   - The empty map: the Mizan hub plus three dashed ghost nodes (store, courier, WhatsApp).
   - The hub fades in and the ghosts draw their outlines with 70ms stagger.
2. **Where do you sell?**
   - A grid of channel tiles with **real logos** from `/v1/integrations/catalog?country=`. EG: Shopify, WooCommerce, EasyOrders (request), "ببيع يدوي". KSA adds Salla and Zid (soon / request).
   - Picking a tile flies its logo into the ghost node (shared-element `<ViewTransition>`, 450ms `--mz-ease`; progressive: where unsupported, the tile fades and the node fades in).
   - Shopify's primary path is "Install from Shopify" (App Store / `/connections/shopify/entry`); the myshopify field is secondary ("عندي عنوان المتجر"). **[CONFIRM]** against the 2026 Shopify App Store requirements whether an app may ask for the shop domain; the answer changes the step-2 layout. For the pilots (`docs/15` L1-4, custom distribution) the install link per store is the path.
3. **Connecting, animated.**
   - During OAuth the edge draws (`.mz-draw`) and a "مستني Shopify" pulse runs on the node.
   - On return the node turns solid with a check draw. Backfill starts the in-lane particles, with a live counter on the node ("340 أوردر · 52 منتج") from `steps.store.import` and an ETA (`etaS`, new).
   - The owner can move on while it imports; the LiveLine keeps it visible.
   - The store name now appears, **locked**, taken from the channel.
4. **Courier.**
   - Bosta tile, plus "شركة تانية / يدوي".
   - The key step is a 3-frame guide (screenshots of where the key is in Bosta, the paste field, the background check). The edge shows "بنتأكد…" then turns solid (`courier.status: checking → done`).
   - A refused key shows the red point, the reason and "حط المفتاح تاني" without leaving the screen.
5. **Costs.**
   - The inline cost grid (`CostsStep`), with Arabic digits normalized and a live bar "الربح ظاهر على X من Y منتج".
   - The primary button is enabled and labelled "احفظ وكمّل"; skipping is allowed. This fixes the disabled-looks-primary state.
6. **First order: time to first value.**
   - When `firstOrder.status = done`, an order card slides along the store edge into the hub and opens to show its real (or provisional) profit and "12 دقيقة من التسجيل".
   - One check draws; no confetti; the red point marks the profit.
7. **Extras (optional, in place):** WhatsApp (connect and check only; script customisation links to the Studio), payments, returns, team. They open as sheets on the same canvas and count separately as "Extras 1/4".

**Mechanics:**
- **True state, strict order:** a step shows as done only when its server status is `done`, and steps render in order; a later step can never show a check while an earlier one is pending (fixes the visual audit's "step 4 done while step 3 pending"). A skipped step shows "Skipped · do it now", never a check.
- **Finished stores:** opening `/onboarding` after setup is complete shows a "Setup complete" map (the real hub and nodes, read-only, with live states) plus the Extras still open and a "Go to Connections" action, instead of restarting the wizard.
- Progress: one bar over the 4 core steps, plus node fill. "Continue setup" lives in the AvatarMenu ring and the Today setup card; reopening resumes at `current(o)` (`OnboardingWizard.tsx:24`).
- Phone: one step per screen; a sticky bottom CTA (safe area); the map collapses into a 72px strip at the top (hub plus nodes as filling dots); key guides open in bottom sheets; no horizontal scroll (FX-1 fixes today's 672px page).
- Reduced motion: nodes fade in; counters update without particles; the steps stay a real `<ol>` with `aria-current="step"`; a live region announces "المتجر اتربط", "بنسحب 340 أوردر", "أول أوردر وصل".
- API additions to `GET /v1/onboarding`: `steps.store.import.etaS`, `steps.whatsapp.templates` (read-only), `trial: { plan, endsAt, daysLeft }`, and catalogue availability (or reuse `/v1/integrations/catalog`).
- Measure: product events per step (viewed, started, connected, skipped) via `modules/onboarding/product-events.service.ts`; `mizan_time_to_first_value_seconds` already exists.

---

## 7. Subscriptions: a 7-day trial on every tier

### 7.1 What exists

- `tenants.plan` is free text (`free / growth / scale / enterprise`) with limits only (`apps/api/src/modules/billing/plans.ts:5-13`).
- `tenants.status = 'trial'` exists but is never set; every store is `active` on `free`.
- Usage metering and soft limits exist (E12-3, E12-1). Upgrade is a JSON request (`usage.service.ts:30-43`).
- No prices, payments, invoices, coupons, dunning or feature gating.
- `MAX_SHOPIFY_STORES = 3` is a config cap, not a plan limit.
- Paymob exists in the engine for merchant links only (E14-2c is pending).

### 7.2 Product model

**Defaults, each admin-configurable in a `billing_settings` platform row editable at `/billing/settings` in admin:**

| Setting | Default | Notes |
|---|---|---|
| `trial_days` | **7** | Every tier the merchant can pick: Growth and Scale run their own 7-day trial; Enterprise is sold by contract, so an Enterprise lead gets a 7-day Scale trial plus "talk to us" (a stated reinterpretation of "trial for all tiers": Enterprise features such as the risk network need a contract). Free needs no trial; it is where a store lands after the trial without payment (D3), another stated reinterpretation. |
| `trial_requires_card` | **false** | Optional "add a card now, charged on day 7". Can be set per currency (e.g. true for USD/GCC). |
| `end_of_trial` | **`downgrade_free`** | Alternative `read_only`. Orders, webhooks and courier sync never stop in either case (hard rule). |
| `free_tier_public` | **false** | Free exists as the safe landing after the trial, but is not sold on the landing or the plan picker. |
| `self_extend_days` | **3** (once) | The "need more time?" button; 0 disables it. |
| `grace_days` (past_due → restricted) | **7** | — |
| `restricted_days` (restricted → expired) | **30** | — |
| `locked_preview_days` (read-only paid screens after downgrade) | **30** | — |
| `reminder_days` | **[1, 5, 6, 7, 10, 14]** | D1 welcome, D5 two days left, D6 last day, D7 outcome, D10 and D14 win-back. |
| `dunning_retry_days` | **[1, 3, 5]** | Skips Fridays and public holidays from the **`platform_holidays`** table (country, date, name_ar, name_en), edited by staff in admin (Platform → Holidays), seeded yearly; prefers the 1st and 25th. |
| `one_trial_per` | **owner user + phone + shop domain** (each as a peppered HMAC, §7.6) | Staff can grant a new trial. |
| `existing_store_policy` | **fresh 7-day trial from the deploy date** for non-pilot existing stores (staging, test, early sign-ups); pilots get comped Scale | Owner decision D18; the alternative is grandfathering them as Free |

**Plan catalogue** (prices are proposals from `docs/01`, kept as versioned rows, never in code):

| Code | AR / EN | EGP / month | EGP / year | USD / month | USD / year | Orders included | Stores | Seats | Overage per order |
|---|---|---|---|---|---|---|---|---|---|
| `free` | مجاني / Free | 0 | — | 0 | — | 300 | 1 | 2 | none (soft cap, upgrade prompt) |
| `growth` | نمو / Growth | 2,500 | 25,000 | 99 | 990 | 3,000 | 3 | 8 | EGP 0.75 / USD 0.03 |
| `scale` | توسّع / Scale | 6,500 | 65,000 | 299 | 2,990 | 10,000 | unlimited | 25 | EGP 0.50 / USD 0.02 |
| `enterprise` | مؤسسات / Enterprise | contract | — | contract | — | contract | ∞ | ∞ | contract |

Rules:
- **Prices live in a price book:** `plan_prices` rows with `valid_from`, editable in admin and grandfathered per subscription through `price_id`.
- **Limits and features live in code:** `PLAN_FEATURES` and `PLAN_LIMITS` move from `apps/api/src/modules/billing/plans.ts` to `@mizan/shared/plans.ts`, so the API, the app and the landing share one contract, pinned by tests.
- **Currency follows the billing country:** EG is billed in EGP through Paymob EG; KSA and UAE in USD by default (SAR/AED are separate price rows later; owner decision D7). Never convert with FX at checkout. `subscriptions.currency` is locked at the first checkout.
- **Features (entitlements),** mirroring `docs/01` §8:
  - Growth: `profit`, `reports`, `warehouse`, `returns`, `allCouriers`, `allGateways`, `automationRecipes`;
  - Scale: + `reconciliation`, `purchasing`, `inbox`, `crm`, `attribution`, `customAutomations`, `publicApi`;
  - Enterprise: + `riskNetwork`, `multiCountry`, `sandbox`.
- **Enforcement:**
  - `@Entitled("feature")` guard returns 402 `plan_required` `{ feature, plan }`;
  - web `<Entitled>` shows a blurred, read-only preview of the real screen with "متاحة في Growth: ابدأ تجربة / رقّي". Never a 404.
  - Stores and seats are **hard** at the moment of the action, with an inline upgrade. Orders stay **soft**.
  - `MAX_SHOPIFY_STORES` stays only as a technical safety cap, raised to 50.
- **Pilots:** migrate pilot stores to `scale` with a 100% comp **before** gating is turned on (matching `docs/15` §1: free pilot, 3 months). Pilots are not 90-day trials.
- **Existing stores (backfill, E12-2a1):** every current tenant is `active/free` today. The migration creates one subscription per tenant: pilots (listed by staff) → comped Scale; every other existing store → `trialing` Growth with `trial_ends_at` = deploy date + 7 days (default, D18) or `active` Free if the owner chooses grandfathering. No store is left without a subscription row (a db test asserts it).
- **Launch offer:** coupon `LAUNCH50`: 100% off, repeating for 3 periods, at most 50 redemptions, by invitation (owner decision D5). Redemption goes through a `SECURITY DEFINER` function `redeem_coupon(code, tenant_id)` that increments atomically (`UPDATE … WHERE redeemed < max RETURNING`); tenants have **no SELECT grant** on `coupons`, so no tenant can list codes.
- **Brandita bundle:** coupon `campaign='brandita_bundle'`, percent **[ASSUMPTION]**, linked to `agreement_ref` and `valid_until`. One coupon per subscription; the launch offer wins.
- **Pass-through usage** (WhatsApp, SMS, AI offers): default is that the merchant pays Meta directly on their own WABA. Billed-at-cost-plus-margin is a per-store setting (memory rule "store owner decides").
- **Billable orders** for overage:
  - `placed_at >= greatest(period_start, subscription.started_at)`;
  - excluding the onboarding backfill and import sources (`orders.source`) and Shopify test orders;
  - cancelled orders counted by default **[ASSUMPTION; D11]** and stated on the pricing page.

### 7.3 States and lifecycle

```
            signup(paid tier)                         pay ok
 (none) ─────────────────────► trialing ─────────────────────────────► active ◄─────────┐
   │ signup(free, if public)      │ trial end: no method / charge fail       │ renewal fail │ pay ok
   ▼                              ▼                                          ▼              │
 active(free)                  expired ─► (new free sub, active)          past_due ─────────┘
                                                                              │ grace_days end
                                                                              ▼
                                                                         restricted (Free entitlements, data kept, still collectable)
                                                                              │ restricted_days end
                                                                              ▼
                                                                          expired (→ free)
 active ─cancel─► active + cancel_at_period_end ─period end─► cancelled (→ free)
 active ─pause (staff / annual, max 3 months)─► paused ─resume─► active
 any ─checkout opened─► incomplete (expires after 24h, previous state kept)
```

| Status | Entitlements | Billing |
|---|---|---|
| `trialing` | chosen tier | none |
| `active` | tier | charges on `current_period_end` |
| `past_due` | tier (full) | retries running |
| `restricted` | Free | retries or a pay link |
| `paused` | Free, data kept | none |
| `cancelled` | Free after the period end | none |
| `expired` | Free | none |
| `incomplete` | previous | first checkout pending |

- `tenants.plan` = `entitlementPlan(subscription)`, written **only** by `SubscriptionService.transition()`. That method runs a table-driven state machine (`billing/state.ts`) with a version check, writes `subscription_events` and emits a domain event. Unit tests cover every edge.
- **Separate the concerns:** `tenants.status` keeps platform lifecycle only (`active`, `suspended`, `deleted`). Update the five `'trial'` readers (`membership.schema.ts:10`, `members.service.ts:144`, `usage-closer.service.ts:43`, `reorder.service.ts:90`, `stores.service.ts:16`), then migrate any `trial` rows to `active`.
- **Trial start:**
  - `CreateTenantSchema` gains `plan?` and `interval?` (default Growth monthly, or the value from the landing URL `?plan=&billing=`);
  - the subscription is created in the **same transaction** as the tenant (`tenants.service.ts:98`);
  - `trial_ends_at` = 23:59 on day 7 in the store's time zone;
  - switching tier during the trial is free and immediate, and the end date does not move;
  - `trials_used` check through `claim_trial(key_hashes[])` (§7.6), never a direct cross-tenant read.
- **End of trial ships with the trial.** E12-2a3 includes a minimal `billing.scheduler` that applies `end_of_trial` (`downgrade_free` by default) at `trial_ends_at` with no payment path needed (a store with no paid invoice simply transitions). Until E12-2a3 is merged, `trial_days` stays 0 in production, so no store can start a trial that never ends.
- **End of trial (`downgrade_free`):**
  - paid screens become locked previews for `locked_preview_days`; new computation stops (profit recompute, reconciliation);
  - seats beyond the Free limit and stores beyond 1 become read-only, **and the owner picks which stay active**; a sales channel is never disconnected silently;
  - automations beyond 3 recipes are paused, not deleted;
  - orders keep flowing.
- **Proration:**
  - day-based: `credit = round_half_even(price_minor × remaining_seconds / period_seconds)` in BigInt;
  - upgrade is immediate (credit old, charge new; card or pay link);
  - downgrade at period end; monthly → annual immediate with credit; annual → monthly at period end;
  - add-ons prorated when added, removal at period end;
  - no proration during the trial;
  - tests include the 3-decimal currency path.
- **Overage:** in arrears on the next invoice: `max(0, billable − included) × unit`. Shown live as "estimated overage this period"; the 80% notification adds "≈ EGP X extra at this pace".
- **Periods:** anniversary billing. A new frozen `usage_periods` table is keyed by subscription period. **Never bill from `usage_months`** (calendar months).
- **Hot-path fix:** replace the per-`order.created` full recount (`limits.consumer.ts:32`) with incremental `usage_counters(tenant_id, period_id, orders)`, updated in the same transaction or debounced to once a minute. Recount only at period close. `UsageCloser` becomes a `SKIP LOCKED` due-queue.

### 7.4 Payments: manual first, Paymob tokens only once confirmed

**Step 1, E12-2b0 (manual billing, ships first, no unconfirmed provider facts):**
- Mizan issues the invoice (E12-2c) and the owner pays by **InstaPay, bank transfer or wallet** with a receipt upload in `/settings/billing`, or through a **merchant-style Paymob payment link** using the Brandita account (the same link capability the engine already has for merchants, no token);
- staff confirm in admin ("Mark paid" with the receipt asset), recorded as `payment_attempts.method='manual'` / `'pay_link'`;
- this lets subscriptions go live for Gate 3 (`docs/15` §1) before any token facts are confirmed. Annual plans are the natural path for these payers.

**Step 2, E12-2b (automatic renewal) — `[UNCONFIRMED]`, design starts only after written answers from Paymob:**
- **Mizan owns** schedule, proration, overage, coupons, tax and invoices. **Paymob charges.** The intended design: (a) the hosted 3DS Unified Checkout for the first payment with "save card", returning a TOKEN, and (b) a **merchant-initiated token charge** at renewal. ("MOTO" in Paymob's vocabulary means a card-not-present integration and may not cover stored-token MIT; the plan does not use that word for this path.) **No PAN ever crosses Mizan**: the save-card and charge flows are hosted or token-only, checked against SAQ-A with counsel.
- Paymob's Subscriptions module is **not** named as a fallback until its API (day-based frequency, variable amounts) is confirmed in writing; until then the fallback is Step 1.
- **Brandita/Mizan's own Paymob account:** platform secrets from Key Vault (`PAYMOB_BILLING_*`), never tenant `secrets` rows.
- **Webhook:** `POST /webhooks/billing/paymob` follows verify (HMAC-SHA512) → dedupe in `billing_webhook_inbox` → enqueue → 200. The job re-reads (`inquire`) before acting. Raw payloads are not stored (they carry `masked_pan`). Routed through `event_intake` (§8) from day one.
- **Token:** encrypted through `SecretsService` with AAD bound to tenant + payment_method; clear text holds only brand, last4 and expiry. The TOKEN path is enabled for the billing account only; the merchant connector keeps dropping TOKEN callbacks. Update `docs/07` and `docs/12` §8; confirm with counsel that SAQ-A still applies.
- **Charges:**
  - reference `mzbill:{invoice_id}:{attempt}`, a new reference for every attempt, never re-sent on timeout;
  - an unknown outcome is resolved by `inquire` before attempt+1 (rule 5);
  - one charge in flight per invoice (partial unique index on `payment_attempts(invoice_id) WHERE status IN ('pending','sent')`).
- **Engine (E12-2b only):** `PaymobConnector.createIntention(..., { saveCard: true })` and `chargeToken(token, amount, reference)`, with fake-server quirks (token callback before the transaction, duplicate token, declined token charge, 3DS required on a token charge) and the chaos suite (rule 15).
- **Paymob facts to confirm in writing** before E12-2b design (every item `[UNCONFIRMED]`):
  1. stored-token merchant-initiated charging for Brandita's account (which integration type, the token-charge endpoint), MIT/3DS-exemption under CBE rules;
  2. the Subscriptions module API, callback shape and HMAC, variable amounts, day-based frequency;
  3. whether zero-amount or auth-and-void "save card" works on Unified Checkout;
  4. TOKEN vs TRANSACTION callback order;
  5. refunds of subscription charges (same path as E14-2d);
  6. whether wallets can be tokenised (assume no);
  7. the USD/GCC provider (Paymob UAE vs Tap vs Checkout.com vs a merchant of record) and the issuing entity (`docs/01` §15).

### 7.5 Tax and invoices [CONFIRM with a tax adviser per country]

- **Egypt:** VAT 14% shown excluding ("+ 14% ض.ق.م"). The issuer submits ETA e-invoices for B2B (buyer RIN, gapless numbering) and e-receipts for B2C. This is Brandita's own ETA onboarding, separate from merchants' M19.
- **KSA:** 15%, reverse charge for a non-resident issuer with a VAT-registered buyer. **UAE:** 5%, same logic.
- `tax_rate_bp` and `tax_country` are stored per invoice and never recomputed.
- Invoices are immutable once `open` (a trigger refuses amount changes). Refunds produce **credit notes**. One bilingual PDF, Arabic RTL, ids in `<bdi>`.
- Gapless numbering via `invoice_sequences … FOR UPDATE`.
- Retention: subscription events, invoices and attempts kept 10 years; `billing_webhook_inbox` pruned after 90 days.

### 7.6 Schema (new migrations; numbers taken at merge time, §11.0)

1. **`billing_catalogue`**
   - `plans(code PK, name_ar, name_en, rank, is_public)`
   - `plan_prices(id, plan_code, kind base|addon|overage|passthrough, addon_code, currency, interval month|year|one_time|per_unit, amount_minor ≥ 0, included_units, unit_amount_minor, valid_from, valid_to, country)` with a unique live row per key
   - `coupons(…)` as specified in the billing report
   - `billing_settings` (single platform row, §7.2)
2. **`subscriptions`**
   - `subscriptions(…)` with a partial unique `(tenant_id) WHERE status NOT IN ('cancelled','expired')` and scheduler indexes on `trial_ends_at` and `current_period_end`
   - `subscription_events` (append-only, no UPDATE/DELETE grant)
   - `subscription_overrides(tenant_id, key, value, reason, staff_id, expires_at)`
   - `trials_used(key_hash PK, kind user|phone|shop_domain, tenant_id)`: a **platform table with no tenant grant** (rule 9). `key_hash` = HMAC-SHA256 with a **platform pepper from Key Vault** (`TRIAL_KEY_PEPPER`), not a plain SHA (an Egyptian mobile space of about 10⁹ values is reversible) and not the per-tenant pepper (which is useless across tenants by design, `pii-cipher.ts:21`). Access only through `claim_trial(key_hashes text[], tenant uuid) RETURNS boolean`, a `SECURITY DEFINER` function owned by the platform role that inserts all keys or reports a prior claim, without revealing which tenant claimed it
   - `platform_holidays(country, date, name_ar, name_en)` (platform, staff-editable)
   - `usage_periods`, `usage_counters`

   `coupons` likewise has no tenant SELECT grant; `redeem_coupon(code, tenant)` is `SECURITY DEFINER`. Both functions get isolation tests in `packages/db` (a tenant role can call them but cannot read the tables).
3. **`invoices`**
   - `billing_profiles`, `invoice_sequences`
   - `invoices` (amounts in BIGINT minor + `CHAR(3)`; ETA/ZATCA status columns; `pdf_asset`)
   - `invoice_lines` (kinds base, proration_credit, proration_charge, overage, addon, passthrough, discount, tax)
   - `credit_notes`, `account_credits`, `account_credit_entries`
4. **`billing_payments`**
   - `payment_methods` (brand, last4, exp, `secret_ref`; no PAN or CVV, ever)
   - `payment_attempts`, `billing_webhook_inbox`, `checkout_sessions`

All tenant tables get RLS like `0038_usage.sql:17-21`, plus isolation tests in `packages/db` and `npm run codegen -w @mizan/db`.

### 7.7 API

**Tenant** (`billing.read` = owner/admin/finance; `billing.manage` = owner/admin):

| Endpoint | Purpose |
|---|---|
| `GET /v1/billing/plans` (also public at `/v1/public/plans` for the landing; cached at the edge for 5 min) | Plans and prices |
| `POST /v1/billing/invoices/{id}/receipt` | E12-2b0: upload a transfer/InstaPay receipt for staff confirmation |
| `GET /v1/billing/subscription` | Includes `trial {endsAt, daysLeft}` in the store's time zone and a next-invoice preview |
| `POST /v1/billing/checkout` | Idempotency-Key; 409 `checkout_open` |
| `GET /v1/billing/checkout/{id}` | Checkout status for the return page |
| `POST /v1/billing/subscription/preview` | Proration and amount due, no side effects |
| `POST /v1/billing/subscription/change` | 409 `downgrade_blocked` with what to remove |
| `POST /v1/billing/subscription/cancel` | `{ reason, comment? }` |
| `POST /v1/billing/subscription/resume` | Undo cancel, or resume from paused |
| `POST /v1/billing/trial/extend-self` | One-time extension |
| `POST /v1/billing/payment-methods` | Hosted save-card session **(E12-2b only; not in E12-2e acceptance until the zero-amount/auth-and-void save card is confirmed)** |
| `DELETE /v1/billing/payment-methods/{id}` | Remove a method |
| `GET /v1/billing/invoices`, `GET /v1/billing/invoices/{id}`, `GET /v1/billing/invoices/{id}/pdf` | Invoices and PDFs |
| `POST /v1/billing/invoices/{id}/pay` | Pay link |
| `PUT /v1/billing/profile` | Legal name, tax id, address |
| `POST /v1/billing/coupons/redeem` | Coupon redemption |

`POST /v1/usage/upgrade` becomes a shim that opens a checkout for one release, then is removed (`docs/05` l.368). `GET /v1/usage` gains `period`.

**Platform** (staff trail plus the store's audit log as `mizan_staff`):

| Endpoint | Purpose |
|---|---|
| `GET /v1/platform/billing/subscriptions?status=&plan=&trialEndsBefore=&pastDue=` | Subscription list |
| `GET /v1/platform/stores/{id}/billing` | Store billing detail |
| `PUT /v1/platform/stores/{id}/plan` | Reimplemented as `SubscriptionService.override`, never a direct write |
| `POST /v1/platform/stores/{id}/trial/extend` (≤30 days) and `POST …/trial/grant` | Trial management |
| `POST /v1/platform/stores/{id}/comp`, `POST …/credit` | Comps and account credit |
| `POST /v1/platform/invoices/{id}/refund`, `…/void`, `…/mark-paid` | Invoice actions (mark-paid with a receipt asset) |
| `POST /v1/platform/billing/attempts/{id}/retry` | Manual dunning retry |
| `POST /v1/platform/billing/webhooks/{key}/replay` | Replay a billing callback |
| CRUD `/v1/platform/coupons`, `/v1/platform/plan-prices` | Catalogue; price changes create new rows |
| `GET/PUT /v1/platform/billing/settings` | §7.2 settings |

### 7.8 Worker jobs

All outbox jobs, `SKIP LOCKED`, safe to repeat:

| Job | Notes |
|---|---|
| `billing.scheduler` | Every 5 min, batch 100, version-checked transitions |
| `billing.trialReminder` | Dedupe `trial:{sub}:{day}`; owner's language. Channels by dependency: the bell (always, no dependency); email **after INF-1** (no email provider exists today in `apps/api/src` or `docs/09`); WhatsApp on **Mizan's own** number **after INF-2** (no Brandita WABA, templates or sender service exist yet). Until then, the bell plus the in-app trial banner carry every reminder |
| `billing.closePeriod` | Writes `usage_periods` once |
| `billing.issueInvoice` | Unique per period and kind; gapless number in the same transaction |
| `billing.charge` | — |
| `billing.verifyCharge` | `inquire` after a timeout or 2 min without a callback |
| `billing.dunning` | Hard declines stop retries and ask for a new method |
| `billing.processWebhook` | Re-read, then apply |
| `billing.renderPdf` | — |
| `billing.cardExpiry` | 30 and 7 days before expiry |
| `billing.reconcile` | Daily, against the Paymob settlement file; mismatches go to admin |
| `billing.etaSubmit` | After tax sign-off |

**Events** (register in `docs/13` Billing):
- `subscription.trial_started | trial_ending {daysLeft} | trial_ended {outcome}`
- `subscription.activated | renewed | plan_changed | cancel_scheduled | cancelled | paused | resumed | past_due | restricted | recovered | expired`
- `invoice.issued | paid | payment_failed {attempt, kind} | refunded | voided | eta_rejected`
- `payment_method.added | expiring`, `coupon.redeemed`

Only `subscription.trial_ending` and `invoice.payment_failed` are visible to merchants as automation triggers. Consumers: entitlement cache invalidation, notifications, the admin Event Center, the Brandita CRM.

### 7.9 Web (apps/web)

- **Plan picker** (`PlanPicker`: the app version lives in `apps/web` with Tailwind; the landing has its own CSS-Modules pricing section; both read the same `/v1/public/plans` contract and `@mizan/shared/plans.ts`):
  - Growth highlighted as an ink card (no badge), Scale, and an Enterprise strip; Free shown only if `free_tier_public`;
  - Month/Year `Segmented` with "شهرين مجانًا";
  - feature rows; "ابدأ تجربة 7 أيام" (the number comes from `trial_days`); "مش محتاج كارت" when applicable;
  - phones: a snap carousel with a sticky CTA.
- **Trial in the shell:** LiveLine "فاضل 5 أيام في تجربة Growth"; a Today card; the onboarding chip. In the last 48h it becomes a BannerSlot entry, counting in hours on the last day, computed from `trialEndsAt` in the store's time zone. It is dismissible per day except on the last day and when past_due. `role="status"`.
- **Other roles** get a neutral variant ("كلّم صاحب المتجر") when the store is restricted. This fixes `PlanBanner.tsx:11,22`, which only shows for `billing.read`.
- **Checkout:** `POST /checkout`, full redirect to Paymob, return to `/settings/billing/return?session=`. That page polls with a skeleton, then shows success (a check draw and a receipt link) or failure (reason, retry, "ادفع بمحفظة/إنستاباي"). It never trusts the query string.
- **`/settings/billing`:**
  - plan card (status chip, trial `Countdown` ring or renewal date, next charge preview);
  - payment method (brand logo, last4, expiry, replace);
  - usage meters (from `UsageScreen.tsx`, fixing the lone-dot meter) with the overage estimate;
  - coupon field; billing profile;
  - Change plan opens the picker with a **preview** before confirming;
  - a 2-step cancel with reasons and a downgrade offer.
- **Invoices:** table (number, period, total, status chip, PDF; "Pay now" on unpaid rows; credit notes nested).
- **`<Entitled>`** locked previews on the gated screens.

### 7.10 Admin (apps/admin)

- **Subscriptions list:** filters (status, plan, trial ending ≤N days, past_due, restricted, coupon); columns for MRR contribution, trial day and dunning step.
- **Store-360 → Billing tab:**
  - subscription card; `subscription_events` timeline (actor, reason);
  - invoices (refund / void / mark-paid); attempts (failure kind, Retry); webhook inbox rows (Replay);
  - actions, each requiring a reason: override plan (now or at period end, list price or comp), extend or grant a trial, comp N periods, add credit, pause/resume, apply the bundle. These replace the Select + Apply at `StoreDetail.tsx:93-97`.
- **Manual payments queue (E12-2b0):** receipts waiting for confirmation, with the invoice, amount, method and receipt preview; Mark paid / Reject with reason.
- **Dunning board:** grouped by next retry; "copy pay link" (always), "send pay link via WhatsApp" (after INF-2) and by email (after INF-1); a case link.
- **Revenue:** MRR/ARR per currency (never summed across currencies without daily FX), trial starts, trial → paid %, churn, recovery %, LAUNCH50 x/50.
- **Catalogue:** versioned prices and coupons.
- **Billing settings** (§7.2) with an audit of every change.
- **Billing health** in the Infrastructure tab: webhook lag, unknown attempts older than 1h, ETA rejections, reconcile mismatches.

---

## 8. Event Center: admin, customer service and the merchant view

**Goal:** every event, including dropped ones, is visible, explained and recoverable, with an audit trail.

Today there are five failure stores (engine outbox, domain events, confirmation steps, automation runs, in-memory engine events). They share no correlation id, and nothing records what arrived before verification.

### 8.1 Fix the silent losses first (FX-3)

1. **W1, atomic intake.** `markInbound` and `enqueue` run in separate transactions (`packages/db/src/tenant.ts:108-115`), so a failed enqueue turns provider retries into "duplicate". Fix: `Store.markAndEnqueue` in one transaction for Shopify (`engine.ts:384→396/400`), Woo (`:436→437`) and Bosta (`:452→453`), or drop `markInbound` and rely on the `mz_outbox` idempotency key. Add a chaos test that kills the DB between the two steps, redelivers, and expects the event processed.
2. **E1:** durable `EngineEventSink` (§5.1).
3. **Durable drift:** `drift_issues` (§5.1).
4. **E3, dead domain events:** `event_delivery_failures(consumer, event_id, attempts, last_error, last_at)` written in `dispatcher.process` catch (`dispatcher.ts:175-179`), plus list and replay endpoints.
5. **W15:** `shopify.pollProducts` (`updated_at` cursor) added to `scheduleReconcile` (`engine.ts:748-763`).
6. **W2:** three or more 401s per connection in 10 min raise `connection.signature_failing` and set `needs_attention` (`webhook_signature`).
7. **W10 / W12:** WhatsApp drops recorded through a **wrapper in `WebhooksController.whatsappEvents`** (`webhooks.controller.ts:43-48`), never inside `whatsapp-chat.service.ts` (hands-off).
8. **Staff replay hardening:** reason required (3–500 characters), refused when disconnected, `revivals` reset, `platform_audit` data `{reason, kind, prevError}`.
9. **Allowlist** dead-letter `payload` keys per job kind; i18n for `StoreDetail.tsx:145`; fix the "5 minutes" schema text (`GUARD.tickMs` is 2 min).
10. **W14:** Paymob webhooks route through intake from day one (E14-2c).
11. **W3/W4, null-route cache:** `webhook-router.ts:13` caches a "no route" answer for 60s, so events arriving during a reconnect are lost. Fix: invalidate the router cache on connect, reconnect and disconnect (a `connection.changed` event consumed by every process; the cache TTL drops to 10s as a backstop); a `disconnected` connection answers `ignored` with an `event_intake` row (never a silent drop).
12. **W5, Shopify marked seen before parse:** `markInbound` runs before the body is parsed (`engine.ts:386-390`), so a parse failure turns every retry into "duplicate". Fix: parse first, then the atomic mark-and-enqueue (item 1); a parse failure answers 200 with outcome `unparseable` + a drift event, and the body is not marked.
13. **W6, no extractable id:** a webhook without a resource id returns `accepted: true` (`engine.ts:395-401`). Fix: outcome `no_resource_id`, a drift event naming the paths tried (rule 2), and a poll-reconcile nudge for that connection.
14. **W8, dedupe-key collisions:** the Bosta key `tracking:code|label:at ?? hash` collapses status reversals; the Woo key uses `date_modified_gmt` at 1s precision; Shopify uses a body hash when there is no event id. Fix: the provider delivery id in the key wherever one exists (`X-Shopify-Webhook-Id`, `X-WC-Webhook-Delivery-ID`); otherwise `hash(rawBody) + receivedAt` bucketed to the provider's retry window. New chaos cases: a Bosta reversal (delivered → returned → delivered), two Woo updates in the same second, a Shopify retry with the same id.
15. **W9, Bosta orphan:** a Bosta webhook with no matching connection is routed to `engines[0]` (`webhooks.controller.ts:97-101`). Fix: outcome `unrouted`, no engine, an intake row and the `unknown_connection` alert signal.
16. **J3:** see §5.1 (`NotConnectedError` becomes a timeline row and a `waiting` state).
17. **E5, consumer rename replays history:** a registry test asserts consumer ids are stable (a snapshot of all ids; renaming needs an explicit migration that copies delivery marks).
18. **R1, dead rows never closed:** dead `mz_outbox` jobs and dead domain events are archived after 90 days to `*_archive` tables (still searchable by staff), so the Event Center does not grow forever; A-10 retention covers intake, R1 covers these.
19. **M3, dropped status webhook:** when a WhatsApp send has no status webhook within the verify window, the guardian re-reads the message status; an alert rule fires when the rate of unverified sends rises (§8.4).
20. **W11 (logged debt):** WhatsApp webhooks are processed synchronously inside the request (a rule 3 violation). It stays as-is while the confirmation code is hands-off; A-15 moves it to verify → intake → enqueue → 200.
21. **Naming:** "store" means both `tenantId` and `connectionId` today. `docs/03` gets a naming note (tenant = the merchant's Mizan store; connection = one channel/provider account); A-11 renames DTO fields that mix them.

### 8.2 Data model

| Table | Content | Retention and privacy |
|---|---|---|
| `event_intake` (partitioned by day on `received_at`) | Every HTTP hit on `/webhooks/*`: provider, endpoint, connection_id/tenant_id (null when unrouted), **outcome** (`accepted, duplicate, ignored, rejected_signature, unknown_connection, unrouted, disconnected, unparseable, no_resource_id, not_configured, too_large, error, unrouted_number`), http_status, reason, latency, provider_event_id, topic, resource_type, resource_ext_id, dedupe_key, job_id, correlation_id, `headers_safe` (allowlist), body_sha256, body_bytes, `body_sealed` (verified only, AES-GCM with the tenant key), body_purged_at, replays | Sealed bodies 7 days; metadata 30 days (90 when not accepted). Unverified bodies are **never** stored. **Privacy topics are never sealed** (`customers/redact`, `customers/data_request`, `shop/redact` and any provider equivalent): metadata only, since their bodies are the very PII being deleted (rule 12). Purged on `customers/redact` / `shop/redact`. **Write path:** for an accepted webhook the intake row is inserted **in the same transaction** as mark-and-enqueue (one round trip, §8.1 item 1); rejected and unrouted hits are inserted as `mizan_worker` (platform role) through an explicit `INSERT`-only policy, because the tenant is often unknown before routing and `tenant_id = app.tenant_id` never matches NULL. Reads: RLS by tenant; null-tenant rows platform-only. A `packages/db` test covers both paths, and runs on **PGlite too** (dev DB) to prove declarative partitioning + RLS on the parent work there; if PGlite cannot, dev uses an unpartitioned table behind the same name. |
| `ops_timeline` (partitioned) | Unified read model: at, tenant, connection, direction (in/out/internal), source (webhook, poll, job, domain_event, consumer, automation, message, reconcile, guardian, staff, merchant, **client**, **ops_device**), type, **status** (ok, ignored, duplicate, retrying, failed, dead, dropped, needs_review, recovered, **lost**), cause_code, cause_owner (merchant/mizan/provider/buyer), order_id, shipment_id, ext_ref, ref_table/ref_id, correlation_id, causation_id, attempt, scrubbed detail ≤300 | 30 days hot, failures 180 days. Fed by an `OpsTap` service plus **AFTER UPDATE OF status triggers** on `mz_outbox`, `confirmation_steps` and `automation_runs`, so confirmation and automation internals don't change. The trigger filter lives in the trigger definition, not app logic: `WHEN (OLD.status IS DISTINCT FROM NEW.status AND (NEW.status IN ('dead','dropped','failed','retrying') OR NEW.kind NOT IN (<poll and housekeeping kinds>)))`, so polls and housekeeping never write `done` rows. Write amplification is measured with `@mizan/perf` before merge (A-10c acceptance). |
| correlation | Nullable `correlation_id` on `mz_outbox`, `domain_events`, `automation_runs`, `confirmation_steps`, `whatsapp_messages`; `last_error_kind` and `cause_code` on `mz_outbox` and `domain_events` | Propagated with `AsyncLocalStorage`: set from `event_intake.id` in the webhook controller, per job in the worker, per event in the dispatcher; read by `EventsService.emit` and `engine.enqueue`. Polls get a fresh id per slot. **No hands-off code changes:** the transaction wrapper (`withTenant`) runs `SET LOCAL mizan.correlation_id = …` from the ALS value, and the new columns default to `current_setting('mizan.correlation_id', true)::uuid`, so inserts in `confirmation.runner.ts` and `whatsapp-chat.service.ts` are populated without editing them. A-15 only verifies it. |
| Client errors | `POST /v1/ops/client-errors` from web and admin: an error boundary + `window.onerror` / `unhandledrejection` + failed mutations (status ≥500 or network) | Rate-limited per user (10/min) and per tenant; PII-scrubbed on the client (no URLs with query strings, no input values) and again with `scrubText` on the server; written to `ops_timeline` with `source='client'`; release + route + browser only |
| Ops-device events | `/v1/ops/sync` rejects and conflicts from the Flutter queue | Written as `source='ops_device'` rows (device id hash, op kind, reason); shown in the store's Event Center lane and in the ops app's conflict sheet |
| Outbound loss checks | Provider accepted a write that later vanished, e.g. a Bosta shipment created but never trackable, a Shopify fulfillment that does not appear on re-read | The guardian re-reads recent accepted writes after a per-kind window (Bosta: no tracking state 24h after creation; Shopify: fulfillment missing on re-read) and writes `status='lost'` with a recovery (re-fetch, then re-create through the idempotent path, rule 5) |
| `ops-causes.ts` (code, `packages/shared`) | Cause catalogue: code, owner, retryable, fix keys (AR/EN), default recovery, safety. Seeded from `ErrorKind`, intake outcomes, Meta error codes (131026, 131047, 132001, 131056, …), Bosta validation codes, `invalid_conditions`, `loop_guard`, `reconcile_gap` | Replaces regex parsing (`sync-guardian.ts:30`). |
| `event_delivery_failures` | Per-consumer failures | — |
| `recoveries`, `recovery_batches` | Every recovery: target, action, safety, reason, actor, previous status and error, result (`queued, skipped_unsafe, skipped_disconnected, already_ok, failed`), new ref, correlation. Batches: scope, filter, reason, dry-run count, status, progress | RLS by tenant; platform reads all. |
| `incidents`, `alert_rules`, `alert_deliveries` | Signals grouped by `(scope, cause_code, connection or provider)`; status open/acknowledged/resolved/muted; assignee; counts; linked case | — |
| `support_cases`, `support_case_events` | Store↔Mizan cases (different from merchants' buyer `tickets`): number, tenant, opened_by (merchant/staff/alert), category, priority, status (new, open, waiting_store, waiting_provider, resolved, closed), assignee, SLA, links to feedback and incidents. Events: message_to_store, message_from_store, internal_note, status, linked_event, access_opened, recovery | The store reads its cases and message events, never internal notes. |
| `automation_runs` change | `attempt` (default 1), `rerun_of`; unique becomes `(automation_id, event_id, attempt)`; step side-effect keys become `(automation, event, stepIndex)` instead of run id (`runtime.ts:61`) | Makes re-runs safe. |
| grants | New tables for `mizan_platform` with PII-free columns; PII-free views over `automation_runs`, `confirmation_steps` and `whatsapp_messages` | The views expose at most a **customer key** = HMAC-SHA256 with a platform Key Vault pepper (`OPS_CUSTOMER_PEPPER`) over the tenant-scoped `customers.id`, never a plain hash of a phone (low-entropy and reversible) |

### 8.3 Recovery registry (`apps/api/src/modules/ops/recovery.registry.ts`)

Each action is `{ action, appliesTo, safety, roles, merchantAllowed, preconditions, dispatch }`. **Rule 14:** the registry never calls another module's internals. It validates, records the `recoveries` row, and then either enqueues **the owning module's own outbox job kind** (engine jobs: requeue, re-fetch, resend dropped) or emits a command event `recovery.requested { recoveryId, action, target, reason }` that the owning module consumes (confirmation re-send, automation re-run, consumer re-run). The owner reports back with `recovery.completed { recoveryId, result }`. Every recovery has a recovery-scoped idempotency key and inherits the original correlation id. Both events are registered in `docs/13`.

| Action | Applies to | Safety | Preconditions | Who |
|---|---|---|---|---|
| Replay webhook | intake `accepted / duplicate / error` with a sealed body | read_then_upsert | connection active, body not purged, signature verified at intake | support+, merchant (own) |
| Re-fetch resource | any order, product, shipment or Paymob ref | read | connection active | support+, merchant |
| Requeue job | dead `mz_outbox` | per kind from `JOB_SAFETY` (`read`, `idempotent_write`, `verify_first`, `unsafe`; undeclared kinds default to `unsafe`, with a test that every handler kind is declared) | `auth / permission` blocked until reconnected; `validation` blocked until the source is fixed (link to the fix) | read/idempotent: support+ and merchant; verify_first: support+; unsafe: super_admin + typed confirmation |
| Replay domain event | dead `domain_events` | safe (delivery marks keep consumers exactly-once) | — | engineer, super_admin |
| Re-run consumer | `event_delivery_failures` row | per consumer `rerunSafe` | flagged rerunSafe | engineer, super_admin |
| Re-run automation | failed run | safe once keys are stable | automation enabled, or "run on the current version" chosen | merchant owner/admin, support+ |
| Re-send message | dead confirmation step, or a WhatsApp message with status `failed` (definite failures only) | new_send (shows cost) | opt-out, 24h window and template approval checked by the confirmation module's consumer of `recovery.requested{action:'resend_message'}` (the `ConfirmationRecovery` handler, **owned by the confirmation module**, **[WAITS: Studio/Template]**) | merchant, support+ with access |
| Re-check lost write | `ops_timeline.status = lost` | read, then the idempotent create path | connection active | support+, merchant |
| Retry device op | `source = ops_device` reject | n/a; the device retries on next sync, or staff discard with reason | — | merchant (warehouse lead), support+ |
| Resolve review | `needs_review` | n/a; deep link to the E7-3 queue or payment review; never a guessed terminal status | rule 7 | merchant ops, staff with write |
| Reconnect / rotate secret | auth, permission, rejected_signature | n/a; deep link to the node | — | merchant |
| Resend dropped | `mz_outbox.status = dropped` | per kind | reconnected | merchant, support+ |
| Dismiss | any failure | n/a; reason required | — | support+, merchant |

**Bulk flow:**
1. filter;
2. **preview** (counts by action and safety, 20 samples, what will be skipped and why);
3. reason;
4. run: worker `RecoveryBatchRunner` in chunks of 50, throttled per connection (rule 4), with progress and cancel.

A batch never mixes classes above `idempotent_write` without super_admin.

Every recovery writes `recoveries` + `platform_audit` (staff) + the store's `audit_log` (`integration.recovered`).

### 8.4 Alerts

`AlertEvaluator` runs every minute. Signals:
- dead jobs per connection above N in 15 min, or any dead job with `cause_owner = merchant`;
- signature failures at 3 or more in 10 min;
- **silence:** no accepted webhook for X hours while polls still recover orders;
- reconcile gap > 0;
- circuit open more than 10 min;
- dispatch lag above 5 min; `outbox_oldest_due` above 5 min;
- a new drift kind;
- an automation auto-paused;
- confirmation dead steps above Y% in 1h;
- spikes of `unknown_connection` / `unrouted` / `unrouted_number`;
- WhatsApp sends without a status webhook past the verify window above Z% in 1h (M3);
- outbound `lost` writes > 0;
- client error spikes per release and route; ops-device rejects above N per store per hour;
- billing (§7.10).

Incidents dedupe by key and auto-resolve after 30 min clear. Channels: in-app (`notifications`, no dependency), a staff webhook (Teams/Slack) and on-call; **email after INF-1**; **WhatsApp to the owner after INF-2** (approved Brandita utility templates only). A `cause_owner = mizan` incident opens or links a support case.

### 8.5 Staff Event Center (apps/admin)

**Routes:** `/events`, `/events/[correlationId]`, `/incidents`, `/cases`, `/cases/[id]`, store-360 `/stores/[id]`. The `/health` page becomes the top strip of `/events` plus an Infrastructure tab, and support gets read access (today it is `super_admin` / `engineer` only, `health.controller.ts:19`).

**Layout:**
- Top strip: worker liveness, dispatch lag, oldest due, open incidents, dead counts.
- **Lanes** (tabs with counts): All · Dropped & failed · Needs review · Retrying · Recovered · Ignored (collapsed).
- **Filters** in the URL: store, connection/provider (logos), direction, source, type, status, cause, owner, time (15m / 1h / 24h / 7d), safety class. Saved views per staff member.
- **Universal search** with prefix parsing: `#1234`, `gid://shopify/…`, tracking numbers, `wamid.…`, UUIDs, store names and domains. Results grouped by `correlation_id` (one webhook and everything it caused in one row).
- **Detail drawer:**
  - the **chain** (intake → jobs → domain events → consumers → automations → outbound), each node with status, attempt, latency and time;
  - the **cause card** (what happened, who must act, how to fix);
  - recovery buttons with safety badges (disabled with a reason in a tooltip);
  - recovery history;
  - payload: `headers_safe` always; the sealed body only with an open A-3 support access grant, each reveal audited as `support.payload_viewed`, scrubbed and allowlisted.
- **Bulk bar** (select rows or "all N matching"): preview → reason → run, with a progress toast.
- **Live:** `GET /v1/platform/events/stream` (SSE; 10s polling first) with a "N new" pill. Virtualized rows.
- **Roles:**

| Role | Access |
|---|---|
| support (the CS panel: a role-scoped route group inside admin by default, D19) | Everything read-only and PII-free, safe recoveries, cases, access requests |
| engineer | + event and consumer replay, drift, infrastructure |
| finance | Payment and billing lanes only |
| super_admin | + unsafe actions |

**Store-360 tabs:**
- Overview (plan/trial, health score, incidents, last sync per connection);
- Events (the same component, scoped to the store);
- Integrations (the map read-only, through `/platform/stores/{id}/integrations/map`);
- Cases; Notes (`platform_store_notes`); Access (A-3 history; request access pre-filled "Case #123: …"); Team; Usage & billing (§7.10); Audit (store `audit_log` + `platform_audit`).

**CS workflow:**
1. **Intake:** the merchant's "محتاج مساعدة" (or FeedbackButton → problem), an alert, or staff open a case. Open incidents and the last 24h of failures attach automatically.
2. **Triage** in `/cases`, by SLA and priority.
3. **Investigate:** inline Event Center plus store summary. Access is requested from the case, read mode by default, and ends automatically when the case resolves. A deep link opens the store dashboard with the support banner.
4. **Fix:** recoveries from the case, each logged as a `recovery` case event and in the store audit.
5. **Reply:** in-app and real time: `/support` is a case thread (not only a case list) where staff messages arrive live on the LV-1 topic `support` with a typing/"seen" state, plus a bell notification; email copies after INF-1. The merchant can attach screenshots (stored as case assets) and the case auto-attaches the page and recent client errors (§8.2).
6. **Resolve:** linked incidents close when clear; one-tap CSAT.

**API (platform):**

| Endpoint | Purpose |
|---|---|
| `GET /v1/platform/events` (filters, cursor, `q`) | Global timeline |
| `GET /v1/platform/events/{correlationId}` | One chain |
| `GET /v1/platform/events/stream` | Live |
| `POST /v1/platform/recoveries` and `POST /v1/platform/recoveries/preview` | Single recovery and preview |
| `POST /v1/platform/recovery-batches`, `GET …/{id}`, `POST …/{id}/cancel` | Bulk recovery |
| `GET /v1/platform/domain-events/dead`, `POST /v1/platform/domain-events/{id}/replay` | Dead domain events |
| `GET/PATCH /v1/platform/incidents` | Incidents |
| `GET/POST/PATCH /v1/platform/cases`, `POST …/{id}/events` | Cases |
| `GET/PUT /v1/platform/alert-rules` | Alert rules |

### 8.6 Merchant view (apps/web)

- **Where:** the Activity and Problems tabs on each Connections node; `/connections/activity` (all nodes); a "Sync history" section in the order Activity tab; `/support` (cases with Mizan); alert notifications.
- **API:**
  - `GET /v1/ops/events`, `GET /v1/ops/events/{correlationId}` (merchant-safe fields);
  - `GET /v1/ops/flow?window=15m` (map aggregates);
  - `POST /v1/ops/recoveries` (merchant-allowed actions only);
  - `GET/POST /v1/support/cases`, `POST /v1/support/cases/{id}/messages`.
- **Lanes:** "محتاجك" (Needs you), "ميزان شغال عليها" (Mizan is handling it, with the auto-retry ETA from `autoRetryAt`), "الكل".
- **Merchant actions:** retry, re-read from store, re-send message, pick the city, reconnect, dismiss. Staff-only causes show "فريق ميزان اتبلّغ · قضية رقم 123".
- **Copy:** grouped by cause ("82 حالة من Bosta: الشحنة مش موجودة عندهم") with one action per group. This replaces staging's 82 identical dead-job rows. Raw text sits behind "التفاصيل".
- This closes backlog U8: the raw view moves to admin, and merchants get an actionable one.

---

## 9. Landing page rebuild

**Decision (default; owner D9):** a new static-export app, **`apps/site`**:
- Next 16 with `output: "export"`, `trailingSlash`, CSS Modules, `next/font/local`, no runtime libraries; versions pinned exactly.
- Routes `[lang]/` with `generateStaticParams` and `dynamicParams = false`; **`legal/[doc]/` (terms, privacy, DPA, cookies; L1-3 / E13-3 content moved from `apps/web/content/legal`) from the scaffold (L1-9b)**, because the footer links them and cut-over cannot ship without them; later `pricing/`, `integrations/[id]/`, `security/`.
- The root `index.html` picks the language: the `mizan-locale` cookie, then `navigator.languages`, then Arabic, with a `<noscript>` link to `/ar/`.
- Hosted on a CDN: Azure Storage static website + Front Door or Static Web Apps **[CONFIRM region policy, `docs/09`]**; Terraform module plus `deploy-site.yml`.
- Strict CSP (`default-src 'self'`; hashed inline picker and module scripts; `img-src 'self' data:`; `connect-src 'self'` only; `frame-ancestors 'none'`).
- **Pricing source: build time + rebuild hook** (D20 default). Prices are fetched from `/v1/public/plans` at build time and baked into the static pages (no runtime API call, so no extra CSP host). A price-book change in admin (E12-2f) fires a `site.rebuild` repository-dispatch to `deploy-site.yml`, so the site updates within about 10 minutes without anyone deploying by hand. The alternative (runtime fetch with the API host in `connect-src` and a static fallback) is recorded in D20.
- After cut-over, delete `apps/web/src/app/(marketing)`, `lib/marketing.ts` and the marketing branch of `proxy.ts`, moving `landing-messages.test.ts` and `marketing.test.ts` to `apps/site/test`, and moving `apps/web/content/legal` to `apps/site/content/legal`. The app keeps redirects from its old legal URLs to the site.

**System:** Brandita's structure (header, footer, cursor, spotlight, liquid seams, ink/paper rhythm, kicker and chapter numerals, the reveal director, hard rules) on Mizan's tokens and fonts (§2). Brandita's hard rules apply:
- never invent a figure or a client;
- red is the only accent;
- no drop shadows, stamps or badges;
- contact details only in the call section;
- transform and opacity only;
- reduced motion stops everything.

**Shared code:** the site uses `packages/ui` (`chrome/`, `brand/`, `motion/` only, the Tailwind-free part, §2.5) and design-system CSS. Purely decorative behaviour (BrandCursor, attach, the reveal director, scroll-spy, the header tone switch) is written as small vanilla `<script type="module">` files outside React, to keep the JS budget (§1.9); React islands are only the FlowMap demo, the chat, the payments radio and pricing. Ported from `C:/Users/ahmed/Brandita/web/src`:
- `SiteHeader` (as the `chrome/` top bar with landing tones), `HeaderContext`, `useHideOnScroll`, `RollingText`;
- `SiteFooter`, `BrandCursor` and `attach` (landing only, fine pointers, motion allowed), `Spotlight`;
- the Liquid kit (`LiquidEdge`, `LiquidField`, `LiquidText`), `Figures`;
- the director pattern (`LandingDirector` ported from `CaseDirector.tsx:51-63` and `HomeHeaderDirector.tsx:117-159`).

**Sections** (I = ink, P = paper with `data-tone="light"`; seams are `LiquidEdge`):

| # | Section | Content | Motion (reduced motion in brackets) |
|---|---|---|---|
| 1 | Header | Bilingual wordmark exports (swapped by tone, never recoloured) + "من براندتا / by Brandita" (hidden ≤1120); links Product · Integrations · Payments · Pricing · FAQ with `aria-current` from scroll-spy; live tick ("الأسعار · 7 أيام تجربة لكل باقة"); a **real** language `<a hrefLang lang>`; "Sign in" text link; `.mz-cta-key` "ابدأ تجربة 7 أيام" → `${APP}/{locale}/sign-in?mode=signup&plan=growth&billing=monthly`. Phones: wordmark, tick, language, red key + a **dock** (Product · Pricing · FAQ · Sign in) with the blob | Tones clear → dark at y≥8, light over paper; hide 36px down / show 6px up at all widths (no transforms, no pulse, blob snaps) |
| 2 | Hero (I) | Kicker "نظام تشغيل التجارة لبراندات المنطقة"; H1 "شغّل كل أوردر. / واحفظ كل جنيه." (second line in mute or stroke, never red text); 2-line lede; CTAs trial + "احجز ديمو على واتساب" (`whatsappLink`, number in one constant, D15); note "7 أيام مجانًا على كل باقة · تلغي في أي وقت · مبني في القاهرة" (card wording from `trial_requires_card`); visual: `FlowMap` demo at about 70% | H1 painted at the first frame (optional 600ms clip wipe from the reading side, never opacity 0); lede and CTAs 80ms apart; lanes draw over 1.2s, particles after idle; LiquidField with 3 pools, blur 90 [static map, chips visible] |
| 3 | The leak (I → P) | "مبيعاتك بتقول رقم. والبنك بيقول رقم تاني."; three rows (refused at the door, cash stuck with couriers, invisible profit) in the CaseIndex row pattern; figures only with a citation | Rows 60ms apart; colour rises behind the hovered row [no stagger] |
| 4 | Integrations map (P) | `FlowMap` demo with real logos; live vs next (dashed) per the catalogue; the demo script every 12s: Bosta degraded "Courier timeout · job retried", then ok "اترجعت لوحدها · 0 أوردر ضاع"; a node click opens a sheet (what Mizan reads, what it writes, setup, live/next) | Particles cap 24, IO pause [static double arrows, a "Last incident: recovered automatically" row] |
| 5 | Product tour (I) | Chapters 01–05 with outlined numerals (order arrives, confirmed, shipped right, reconciled, profit); a sticky device frame at the inline end with HTML/SVG mock screens built from real component looks, labelled "بيانات مثال"; header tick names the chapter, progress ring fills | Screen crossfade + 16px when a chapter crosses 45% [inline screens, no sticky]; phones: text then screen |
| 6 | Profit per order (P) | Waterfall 2,100 → −920 → −85 → −38 → −545 → **512**; insight tile "هامش 24% على الأوردر ده · بيانات مثال" | Bars scrubbed by `animation-timeline: view()` (entry 20% → cover 50%); `LiquidText` net figure; Firefox shows the final state [final state] |
| 7 | WhatsApp confirmation (I) **[WAITS: Studio + Template]** | The Studio's `WhatsAppPhone` **style-agnostic core** (agreed with the Studio branch, §0: plain props for strings and direction, CSS Modules or design-system classes, no Tailwind and no next-intl inside), never reimplemented; if the branch cannot expose that core, the landing keeps its own static chat built from the same message fixtures. Static fallback until merged; voice switch over the four templates (Egyptian, formal Arabic, Gulf, English) "متجرك بيختار الصوت"; second beat: risky order → deposit link → "المندوب يحصّل 1,800 مش 2,100". Bubbles `dir="rtl" lang="ar"` except English | Typing dot 300ms, bubble pop .96→1 over 220ms spring, starts at 50% visible, tap to step (`data-cursor="Next"`), Play/Pause/Replay [whole chat static + Replay] |
| 8 | Payments (P) | Radio group: COD · Card · Wallet · Deposit + COD · BNPL · Bank transfer; the parcel card "المندوب يحصّل …" with values **generated at build time from `cashToCollect`**; rule tile "الدفع الناقص أو المجهول عمره ما يتشحن" | RollingText 300ms, parcel tilt 2° spring [instant swap] |
| 9 | Automation Studio (I) | Recipe "When order created → If risk ≥ 60 and COD → Send deposit link → Ship when paid"; 6 chips; mini run log ✓ ✓ ↻ "واتساب حدّد السرعة، اتعاد بعد 30 ث ✓" | A particle travels the steps (FlowMap engine) [static] |
| 10 | Modules (P) | Domains Operate · Money · Grow · Platform as filter pills over rows, each **Live / Next** from `content/modules.ts`, reviewed per release (fixes POS and AI analyst being shown as live) | 200ms filter fade |
| 11 | Pricing (P, `#pricing`) | "بنسعّر بالأوردرات، مش بالنسبة"; banner "كل باقة تبدأ بـ7 أيام مجانًا"; Monthly/Annual and Egypt/GCC toggles; Growth, Scale (Growth as the ink card), Enterprise → WhatsApp; Free only if `free_tier_public`; trial terms (day 7 outcome, day 5 reminder); data from `/v1/public/plans` at build time via `@mizan/shared/plans.ts`, refreshed by the rebuild hook (D20); **behind `SITE_SHOW_PRICES`** (off → "الأسعار مع الإطلاق · انضم للتجربة") | Price digit roll, thumb `--mz-ease-spring`, `aria-live` sentence kept [instant] |
| 12 | Proof (I, gated) | Until approved pilots exist: a "Pilot programme" block (assisted onboarding, weekly pilot report L1-7, direct WhatsApp line); afterwards StoryCard/FeaturedCase frames gated on `real && approved`. Never invented quotes or logos | — |
| 13 | Trust (P) | Azure UAE North · encrypted customer data with access logged · Law 151/2020 and PDPL · card data never enters Mizan; each row links to `/security` and legal (must match `docs/07`) | — |
| 14 | FAQ (P, `#faq`) | Native `<details name="faq">` group; adds trial, cancel, live vs next couriers and gateways, KSA, data export, WhatsApp costs; FAQPage JSON-LD from the same messages | "+" rotates 45° spring |
| 15 | Call section (I) | Ported `CallSection`: LiquidEdge from paper with a red tint; "كل أوردر، في الميزان." at `clamp(60px,12vw,210px)`, line height 1.25 in Arabic; trial pill with `.mz-pour`; secondary WhatsApp; contact lines (email, WhatsApp, Cairo clock) only here; the `.ld-scale` beam | [still] |
| 16 | Footer | Gradient melt into ink; one row (Product, Integrations, Pricing, Security, Privacy, Terms, DPA, social **[CONFIRM accounts]**); XL bilingual wordmark rising (`animation-timeline: view()`, clip-path; `min(100%, 640px)` in Arabic); colophon "© 2026 Mizan · Powered by Brandita · Cairo" with the endorsed mark, language link and "Back to top" (`<Icon name="up">`, no literal ↑) | [no rise] |

- **SEO:** canonical and hreflang (`ar-EG` as x-default, `en`, later `ar-SA`); OG images per locale via `next/og` with Alexandria (works for static routes under `output: "export"` **[CONFIRM with Next 16]**; fallback: PNGs generated by a build script); Twitter `summary_large_image`; JSON-LD `Organization` (parent Brandita), `SoftwareApplication` (offers only when prices are published), `FAQPage`; static `sitemap.xml` and `robots.txt`. Phase 2: `/integrations/{shopify,woocommerce,bosta,whatsapp}/`, `/payments/cod/`, `/security/`.
- **Partner marks on the landing** follow §5.9 (brand-provided black/white variants only where allowed; colour on a neutral tile otherwise); "Works with Shopify" wording only once allowed.
- **i18n and RTL:** keep the `landing` JSON namespace and its tests (key parity, Western digits, Arabic-only check, WhatsApp text always in Arabic); a new test that every `data-cursor` and tick string exists in both languages; the ESLint rules (no physical directions, no literal strings); `letter-spacing: 0` for Arabic; FlowMap mirrors its layout, not its labels; check every width from 320 to 1920.
- **Removed:**
  - the theme toggle and `NO_FLASH` script (dark ink with paper sections, like Brandita);
  - `icons.tsx` (use the design-system sprite);
  - the 140px blur fields;
  - the `.rise` opacity + blur on the H1;
  - the 14-day trial copy;
  - "بلاش لحد 300 أوردر" (unless Free is public);
  - the `mailto:` demo link;
  - text-pill integrations.

---

## 10. Locked data rules

**Rule:** a field owned by a channel or provider renders as `SourceField mode="locked"`:
- value; a lock icon; a source chip with the partner logo ("من Shopify"); a tooltip and a link "غيّره من Shopify ↗"; `aria-readonly="true"` and `aria-describedby` set to the source sentence.
- The API refuses edits with **409 `field_from_channel`** `{ field, source }`.

Other modes:
- `synced` (two-way arrow icon, "بيتحفظ هنا ويتبعت لـ Shopify");
- `override` (a channel value replaced in Mizan, with "ارجع لقيمة Shopify");
- `mizan` (dot, "في ميزان بس").

`TenantView` gains typed `brand: { source, connectionId, shopName, follows, logoUrl, squareLogoUrl, color, url, currency, timezone, country, access, syncedAt }` (today `settings` is untyped). Each product field returns `sourceOf`.

| Field | Owner (where it comes from) | Mode | Notes |
|---|---|---|---|
| Store name | Shopify `shop.name` → `settings.brand.shopName`; Woo `/wp-json` `name` (new read via Resolver and `send()`) | locked while "Follow the channel's name" is on (Default **on**; a per-store owner setting); off → a separate "Name in Mizan" (override) with reset | Replaces the implicit "a rename wins" (`store-profile.ts:58-60`); `UpdateTenantSchema.name` refused while following (`tenants.dto.ts:29`). Shown locked in the StoreChip, onboarding and Settings → Store |
| Logo, square logo, brand colour | Shopify Storefront `brand.*`; Woo `site_icon_url` | locked | `access` states: read / no_access (approve the scope link) / none ("حط لوجو في Shopify ↗"). Upload only for stores with no channel (manual) |
| Primary domain / store URL | Shopify `primaryDomain.url`; Woo `url` | locked | Shown on Store and the node, with an external link |
| myshopify domain | `connections.external_account` | locked | Mono, secondary text, never a heading |
| Store currency | Shopify `currencyCode` (read but not applied today) | locked (Mizan's `base_currency` is locked since signup) | Mismatch warning "Shopify بيبيع بالدولار؛ ميزان بيحسب بالجنيه بسعر يومي" → FX; needs `brand.currency` stored |
| Time zone | Shopify `ianaTimezone` | override allowed: suggested on connect, editable, "Differs from Shopify" badge | Reports may need another business day |
| Country | Shopify billing country | locked | Mismatch warning |
| Contact email | Shopify | locked | Display only |
| Connection label | Mizan (`display_name`) | editable ("Label in Mizan") | Never shown as the store name |
| Mizan slug | Mizan, at signup | locked (not a channel field) | Relabel "عنوان المتجر على ميزان" |
| Customer message locale | Mizan | editable | Store owner decides |
| Order number, `placedAt`, channel unit prices, line items as placed | Channel | locked | Edit order changes lines and fee only through Mizan's edit flow, which writes back; channel price shown locked (`EditOrder.tsx:390`) |
| Order source, UTM, campaign | Channel order attributes | locked | "من أوردر Shopify" link |
| Product title, status, tags, description, vendor/type (Shopify), image order | Channel | **synced** (written back) | Fix `products.ownership` and `products.editor.storeFields` copy |
| Variant price, compare-at | Channel | **synced**; a later store change wins (owner decision D10 on a price lock) | Remove the false `pricesHint` "put back" claim now |
| SKU, options, option values, handle | Channel | locked | — |
| Store stock ("available" in the store) | Channel `v.available` | locked ("رقم Shopify") | Tooltip when push is on: "ميزان بيبعت عدّه هنا" |
| Product images (channel products) | Channel | reorder only (synced); upload and delete in Shopify | Upload allowed for Mizan-made products |
| Barcode | Channel until set in Mizan (`barcode_set_at`) | override with reset | Uses the existing `barcodeOwner` |
| Cost, low-stock threshold, bin, supplier links | Mizan | mizan | — |
| WhatsApp display number, verified name, quality rating, messaging tier | Meta | locked ("من Meta") | New engine read; shown on the node; Studio internals untouched |
| WhatsApp phone number id, WABA id | Meta | locked (mono, secondary) | Today the settings card shows the id instead of the number |
| Template approval status | Meta | locked (read-only) | Editing belongs to the Studio/Template branches |
| Bosta business name, account id | Bosta | locked | — |
| Bosta pickup locations | Bosta | locked (managed in Bosta), choose the default | — |
| Courier zone names | Courier zone list | locked; **rate per zone editable** (Mizan's cost) | Replaces the free-text zone (`CostsScreen.tsx:262`) |
| Learned courier status codes | Engine | locked (read-only); mapping through the Fix queue with audit | Rule 7 |
| Woo site name and URL | Woo | locked | — |
| Shipment tracking number, courier status raw text | Courier | locked | — |
| Payment gateway transaction id, card brand and last4 | Gateway | locked | — |
| Subscription invoice amounts once open | Mizan billing | locked (immutable) | Credit notes only |

---

## 11. Delivery plan

### 11.0 Rules for parallel work

- **Migrations:** the last migration on main is `0073_after_confirmation.sql`, and the open branches may add more. Each PR takes the next free number **at merge time**, renaming on rebase. Add a `packages/db` test that numbers are unique and continuous.
- **Generated files** (`openapi.json`, `apps/web` and `apps/admin` `schema.d.ts`, `packages/db/src/schema.ts`) are never hand-merged: regenerate after rebase.
- **Messages:** split `messages/{ar,en}.json` (about 4,859 lines, 247KB) into per-namespace files (SH-0). The Studio and Template branches are adding keys to `ar.json`/`en.json` right now, so SH-0 **splits every namespace except `confirmationSettings`, `afterConfirmation` and `offersSettings`**, which stay in the legacy files; a loader merges the legacy files with the per-namespace files (a parity test covers both). After both branches merge, SH-6 moves those three namespaces out. Until SH-0 lands, each PR adds keys only under its own new namespace.
- **Shared hot files** have an owner order; later PRs rebase on the earlier ones:
  - `lib/nav.ts` and `settings-nav.ts`: SH-2;
  - `Shell.tsx`: SH-3;
  - `tokens.json`: DS-1;
  - `packages/engine/src/engine.ts` intake and `apps/api/src/integrations/webhooks.controller.ts`: **FX-3 → CN-1 → A-10a → E12-2b** (Paymob billing route), strictly in this order, one open PR at a time on these two files;
  - `apps/web/src/components/ui/*`: DS-4 (shims only until CLN-1).
- **Each PR:** typecheck, tests, AR + EN strings, an RTL check in `/ar/ui` and the responsive contract e2e, no secrets or PII in logs, docs (`docs/04`, `docs/05`, the module doc), backlog ticked. When engine code changes: the chaos suite and `/chaos-check`.
- **Existing e2e suites:** every PR that moves a route or swaps chrome updates the affected suites in the same PR (`apps/web/e2e/navigation.spec.ts`, `home.spec.ts`, `call-queue.spec.ts`, `confirmation.spec.ts` and the rest; admin e2e on the emulator stack). `data-testid`s are kept stable (as already done for `mobile-nav`); new chrome reuses the old ids where the role is the same.
- **Hands-off** until the Studio and Template branches merge: §0 list. Items marked **[WAITS]** start only after they merge.

### 11.0b Go-live coupling and rollout (`docs/15`)

- **Priority:** launch tasks first each day; from week 5 (L3), 30% of capacity on pilot fixes. Redesign work that helps go-live goes first: FX-1, FX-2, FX-3 (silent losses), CN-1 telemetry, A-10a intake, E12-2b0 manual billing (for Gate 3).
- **Flags (A-6, already built):** each visible change ships behind a per-store flag, default off for pilot stores and on for new stores once stable:

| Flag | Covers |
|---|---|
| `shell_v2` | SH-3 frame, dock, LiveLine, BannerSlot, the optional rail (D17) |
| `connections_map` | CN-3/CN-4 map and drawer (the old Integrations/Store sync pages stay reachable while off) |
| `onboarding_v2` | OB-1/OB-2 |
| `entitlements` | `@Entitled` gating and locked previews (turned on only after pilots are comped) |
| `screens_v2.<area>` | each SC item that changes a daily workflow (orders list, order detail, call mode, fulfil) |

- **No shell or workflow swap for pilot stores during L3/L4 (weeks 5–9) without the owner's OK** per store; the owner turns flags on from admin Flags (§4.24). Redirects (SH-4) apply only when the matching flag is on.
- Flag removal is part of CLN-1, after every pilot has run on the new version for two weeks.

### 11.1 Lanes and milestones

Sizes: S ≈ 1–2 days, M ≈ 3–5 days, L ≈ 1–2 weeks (split further if needed). New backlog IDs are to be added to `docs/10-backlog.md`; check for clashes with existing IDs first.

**Lane 0: P0 fixes (start now; no dependencies)**

| ID | Scope | Areas | Tests | Acceptance |
|---|---|---|---|---|
| FX-1 (M) | B1 (the 20 files listed in §4 + ESLint rule), B2, B3, B6, B8; phone overflow on Home and Onboarding; bidi dates, names and phones; ActivityLog keys + fallback; one theme source; server strings to codes; welcome currency; `whatsapp_cloud` / `manual` names; `formatMoney` contract; catalogue-driven `METHODS` / bell providers / `FEE_METHODS` (X9); toast offset; sticky table header fix; **responsive contract e2e** (390×844, 844×390 landscape, 820, 1440, plus a coarse-pointer 1280 case: `scrollWidth ≤ innerWidth`, no visible control under 24×24 (44×44 on coarse), no Latin `[a-z]{4,}` outside `<bdi>` in `/ar`, no Arabic-Indic digits in rendered output) | `apps/web` components listed in §4; `apps/api` shipping and ingest strings; `apps/web/e2e/responsive.spec.ts`; `packages/shared` money | `test/messages.test.ts` (namespaces exist), lint rule test, unit tests for formatters, e2e contract | Contract green on all routes; staging screenshots of Home and Onboarding on a phone show no sideways scroll |
| FX-2 (S) | Profit honesty: "Provisional profit" and missing-cost chips on Today, order Overview, Profit and Reports; "0.00" becomes "ناقص" | `components/home`, `profit`, `reports`, `orders/ProfitCard`; metric layer flags (`costsComplete`, `delivered`) | Metric unit tests; component tests | No 100% margin shown while costs are missing |
| FX-3a (M) | Atomic intake W1; parse-before-mark W5; `no_resource_id` W6; dedupe keys with provider delivery ids W8; Bosta orphan unrouted W9; router cache invalidation W3/W4; `mz_outbox.status = dropped` + disconnect change | `packages/engine` (store, engine.ts), `apps/api/src/integrations/webhook-router.ts`, `webhooks.controller.ts`, migrations | Chaos: W1 kill-between-steps, Bosta reversal, two Woo updates in one second, Shopify same-id retry, reconnect during a burst; chaos suite green | Redelivery after an injected enqueue failure is processed; no event lost during reconnect in the chaos run; disconnect keeps dropped jobs |
| FX-3b (M) | Durable `EngineEventSink`; `drift_issues`; `event_delivery_failures`; `shopify.pollProducts`; signature-failing signal; J3 waiting state; E5 stable consumer-id test; staff replay hardening; payload allowlist | `packages/engine` (worker), `apps/api/src/integrations/*`, `platform/events/dispatcher.ts`, migrations | db tests; API tests; registry snapshot test | Drift visible across processes; a skipped store shows `waiting`; renaming a consumer fails CI |

**Lane A: design system and kit (start now)**

| ID | Scope | Depends on | Tests | Acceptance |
|---|---|---|---|---|
| DS-1 (M) | Palette (D1 default), island edge/glow tokens for dark, Geist 800/900, §2.3 tokens, build.mjs emitters, reduced-motion map, Tailwind entries, Flutter output (with OP-1), logo/icon fills, DESIGN.md and README | owner D1 (default applies if no answer) | design-system 70 tests updated, contrast in both themes, `design-classes.test.ts`, ops `design_system_copy_test.dart` | Gallery renders with the new palette in both themes; the hero island is distinct in dark; Flutter tokens regenerated and the ops suite green |
| DS-2 (M) | `chrome.css` (topbar, navlink, tick, roll, cta-key, dock, sheet, drawer, reveal, pour, flow, flash, lock, spot) + solid cards on coarse pointers / reduced transparency + RouteMotion easing swapped to `--mz-ease` + glass-bridge logical fixes + `GlassRoot` dir check + reference template | DS-1 | "no undefined CSS variables" test; RTL snapshot in `reference/`; a test that only `.mz-topbar`, `.mz-dock` and `.mz-sheet` use `backdrop-filter` under `(pointer:coarse)` | Reference page shows every tone and state in AR/EN, light/dark |
| DS-3 (S–M) | Partner logos: manifest with `guideUrl`/`allowedVariants`/`minPx` per brand, simple-icons paths (exact version) checked by `check-partner-slugs.mjs`, brand-provided mono files only where allowed, monograms for the rest, `PartnerLogo`, design-system test | — | Manifest/scrub/slug test | Every catalogue slug resolves to a logo or a monogram; no mono file without an allowed variant |
| DS-4a (M) | `packages/ui`: motion + page + status + input primitives; **re-export shims** in `apps/web/src/components/ui/*` | DS-2 | Vitest + Testing Library, keyboard and RTL arrow tests, axe | Web builds on `packages/ui` through the shims; the Studio/Template branches rebase without changes |
| DS-4b (M) | DataTable v2 + RecordDrawer + Sheet/Drawer + Tabs URL state + Dialog exit (progressive)/sheet + Toast (Sonner) | DS-4a | As above | Gallery covers every component at 3 widths × 2 languages × 2 themes |
| DS-4c (S–M) | Admin switched to `packages/ui`, its copy replaced by shims, then deleted in CLN-1 | DS-4b | **Admin e2e on the emulator stack after the switch** (every A-1…A-7 page) | Admin e2e green; no visual regressions in the admin gallery screenshots |

**Lane B: shell and IA**

| ID | Scope | Depends on | Tests | Acceptance |
|---|---|---|---|---|
| SH-0 (S) | Split messages per namespace **except the three hands-off namespaces** (kept in the legacy files, merged by the loader, §11.0); per-route `NextIntlClientProvider` with `pick` | — | i18n parity test across legacy + split files | Route payload contains only its namespaces (checked by a bundle test); the Studio/Template branches rebase without message conflicts |
| SH-1 (S) | **Scope reduced to avoid colliding with SC items:** `Page` + `PageHeader` + `Breadcrumb` components ship in DS-4a; each SC item adopts them for its own screens. SH-1 only migrates the pages no SC item touches (static pages, settings pages outside SC-17, print, gallery) and adds `error.tsx`, `not-found.tsx`, `global-error.tsx`; LeaveGuard wherever a SaveBar is used | DS-4a | e2e on 404 and error inside the frame | After all SC items: one header pattern; no hand-written `<h1>` outside the hands-off files (lint rule) |
| SH-2 (M) | Nav registry v2 (children, counts, flags, settingsHref, short labels), ⌘K fed from the registry, the "every route registered" test, `can()` for palette actions, keyboard shortcuts (`g x`, `/`, `n`, `?`) + shortcut sheet; `GET /v1/inbox` counts (U13) | — (API part parallel) | Registry test; API test for inbox | ⌘K finds every child, settings and connections page |
| SH-3a (L) | New frame behind `shell_v2`: AppTopBar, HubLinks + priority+, LiveLine (replaces SyncIndicator and most banners), SectionNav, AvatarMenu, StoreChip popover (U9), Dock (short labels) + More Sheet, BannerSlot, hide-on-scroll gated on open layers, §3.2 input-mode rules (landscape mini bar, coarse pointer, keyboard/`visualViewport`), landmarks (SH-9), frame before the gate (SH-7), PF-1 parallel first query + hover prefetch + placeholder/persisted cache, side rail removed with the optional ≥1280 icon rail (D17) | DS-2, DS-4a, SH-2 | e2e: dock keeps `data-testid="mobile-nav"`, hide-on-scroll never hides with a layer open, keyboard nav, axe landmarks, 844×390 landscape case, dock labels ≤12ch; existing `navigation.spec.ts`/`home.spec.ts` updated | Shell matches §3 at all widths with the flag on, today's shell with it off; Lighthouse frame paint ≤1.2s in lab; hide-on-scroll + SectionNav checked on a real iPad |
| SH-3b (S–M) | The same shell in admin | SH-3a, DS-4c | Admin e2e | Admin uses `AppTopBar` |
| SH-4 (M) | IA moves + redirects (active when `shell_v2` is on for the store): `/connections` shell route (placeholder list until CN-3), `/settings/billing` route (usage merged), `/settings/approvals`, pick lists under Fulfil, settings regroup, "Calls" label, `/account` (with the rail preference), deep-link updates for every fix link | SH-2 | Redirect tests; link tests; affected e2e suites updated | Old URLs redirect; no link points to `/onboarding` as a fix |
| SH-5 (S) | Settings menu entry for the Confirmation Studio (label and group only) | SH-2 | — | No change inside the hands-off files |
| SH-6 (S) **[WAITS: Studio, Template]** | PageHeader on the confirmation screens, Studio tokens follow-up, the template choice in the Studio toolbar, move the three hands-off namespaces out of the legacy message files | the branches merged, DS-1 | Studio tests stay green | Owner's toolbar step done |

**Lane C: live updates (API + web)**

| ID | Scope | Depends on | Tests | Acceptance |
|---|---|---|---|---|
| LV-1a (M) | API: `GET /v1/live` SSE + `POST /v1/live/token` (single-use, bound to tenant + user + topics) + heartbeat + Fastify/compression check; `token` stripped in the redacting logger and infra log config | — (starts week 1) | API SSE test (reconnect with a new token, reuse refused, auth expiry); logger test that `token=` never appears | **SSE smoke test through staging ingress / Front Door** passes (events arrive unbuffered within 2s) |
| LV-1b (S) | Web: `useLiveTopic` with polling fallback, manual reconnect with a fresh token, close on hidden/`pagehide`/`freeze`, `saveData` polling; `.mz-flash` row flash, "N new" pill, row leave, badge throttle | LV-1a, DS-4b | Hook test (falls back to polling, reconnects) | An order created in Shopify appears in an open list without reload |

**Lane D: screens** (each S–M unless marked; any order after DS-4b; parallel across files; each adopts `Page`/`PageHeader` for its own screens, so no SH-1 collision)

| ID | Scope | Depends on |
|---|---|---|
| SC-1a | Order detail header: Pipeline, locked fields, NextStep panel (state-driven), courier choice on ship (`POST /orders/{id}/ship {connectionId?}`), reveal-and-call | DS-4b, LV-1b |
| SC-1b | Order detail tabs + combined `GET /orders/{id}?include=` API; ViewTransition list → detail (progressive) | SC-1a |
| SC-1c | Edit in place: address inline, lines/fee edit sheet, "At the door" sheet with Steppers | SC-1b |
| SC-1d **[WAITS: Studio]** | Conversation tab with read-only `WhatsAppPhone` (Studio exposes the `transcript` prop) | SC-1b |
| SC-2 | Orders list: QueueChips, FilterSheet, saved-view chips, row actions (always visible on coarse pointers), sticky bulk bar, filter-based bulk API, bulk preview, phone cards and swipe; ViewTransition into the drawer (progressive) | DS-4b, LV-1b |
| SC-3 | New order polish (sticky phone total, source chips with logos, RadioCards, Steppers, step-4 fix) | DS-4a, DS-3 |
| SC-4 | Call mode (auto-advance, Undo, outcome bar, Up next, live skip banner); Results tab | SC-1a; script rendering read-only now, **[WAITS: Studio]** for richer script features |
| SC-5 | Fulfil: Ship / Track / Fix / Couriers, raw-status mapping API, import preview, inline cancel (B7) | DS-4b, DS-3, LV-1b |
| SC-6 | `/returns` work screen with scan + exchange 3-step sheet + exchange preview API | SC-1b |
| SC-7 | Money: headline numbers, work chips, settlement by courier API, order money drawer; refunds sheet + preview API + bulk approve; disputes drawer + Countdown | DS-4b |
| SC-8 | Tickets split view, per-field save, Resolve tab, Take next, new-ticket chips | DS-4b, SC-7 (refund sheet) |
| SC-9 | Customers (M9) list and detail + API; phone search through the existing `customers.phone_hash` blind index; the name-search decision recorded in `docs/07` | DS-4b |
| SC-10 | Products: store column, view chips, inline costs + batch API, SourceField states, import preview, server export | DS-4b, CN-6 (sourceOf) |
| SC-11 | Stock: empty state, chips, bin UI, count mode, item drawer; pick-list barcodes | DS-4b |
| SC-12 | Purchasing: needs-reorder strip, cover bars, Steppers, currency Combobox | DS-4a |
| SC-13 | Today: hero honesty (after FX-2), Action inbox, setup path card, KPI sheets, one-line KPI hints (1.7), PeriodPicker, chart scrubber, PaymentMix states from the catalogue, activity shared with the bell | SH-2 (inbox), DS-4a |
| SC-14 | Profit, Ads/ROAS, Ad spend import, Reports (dictionary sheet, charts, Export ▾) | DS-4b |
| SC-15 | Automations canvas, recipe gallery, run-log drawer with re-run (needs A-11 rerun semantics), translated dry run | DS-4a, A-11 for re-run |
| SC-16 | Notifications: structured payload API, sheet, per-row read, `/notifications` | DS-4b |
| SC-17a | Settings: Store profile locks, Team cards and role sheet, Roles matrix, `/account` (incl. the rail preference) | SH-4, CN-6 for locks |
| SC-17b | Settings: Costs single SaveBar + connected couriers + FX table (display rounding only) + server recalculation job; Payment methods and fees (catalogue-driven) | SH-4 |
| SC-17c | Settings: Approvals, Inventory, Purchasing card, Audit log diff timeline with translated entity labels (9.8), Privacy/Orders inside `Page width="form"` | SH-4 |
| SC-18 | Print (history back, Code128), Welcome restyle, gallery wrapped in GlassRoot | DS-4a |
| SC-A (L, split per page) | Admin screens per §4.24: stores search with health chips, user detail, flag matrix, announcement composer with preview, staff and roles, access, staff trail | DS-4c, SH-3b |

Each SC item ships with: component tests (keyboard, RTL), e2e on the main path at 390, 844×390 and 1440 in AR, **the job's flow-budget e2e from principle 11** (counted interactions must not exceed the budget), the affected existing e2e suites updated in the same PR with stable `data-testid`s, its `screens_v2.<area>` flag where it changes a daily workflow, AR/EN keys, `docs/05` for every API addition.

**Lane E: Connections map**

| ID | Scope | Depends on | Tests | Acceptance |
|---|---|---|---|---|
| CN-1 (M) | `connection_runtime`, `connection_activity` with the in-memory per-process aggregation and 5–10s batched flush (never on the webhook fast path); per-connection dead-letter SQL; `/sync` grouped; `ConnectionsController` move; typed health schema, old route shimmed with a removal date | FX-3a, FX-3b | db RLS tests, API tests, chaos green, `@mizan/perf` webhook p95 unchanged | Breaker state from the worker visible via the API within 5s |
| CN-2 (M) | `GET /v1/integrations/map` (server health derivation incl. `waiting` and the Payments pseudo-nodes), `GET /v1/integrations/catalog` (shared constant), `GET /v1/connections/{id}` (incl. pickup locations, city aliases, learned codes, zones), `/activity`, `/check`, `/reconnect`, `/sync-options`, `/integrations/requests`, `DELETE …/city-aliases/{raw}` | CN-1, DS-3 | API tests per health rule | Health rules covered by unit tests; openapi and types regenerated |
| CN-3a (L) | `FlowMap` in `packages/ui`: desktop radial + List view + reduced motion + IO pause + WAAPI particles with coarse-pointer caps + per-direction path generation; the **mini FlowMap** (hub + ghost nodes, no live data) as a separate export for onboarding and the landing demo; `/connections` route on polling + toolbar, behind `connections_map` | DS-2, DS-3, CN-2 | Lane geometry unit tests (path snapshots for `ltr` and `rtl`), status → label, a11y (axe), e2e map and list, a frame-rate check on a throttled mobile CPU profile | Owner request shown on desktop: Mizan in the middle, two-way animated flows, real logos, red only on failure |
| CN-3b (M–L) | Phone spine (<640) and tablet clusters (640–1023) | CN-3a | e2e at 390, 844×390 and 820 | The same states readable on every device |
| CN-4 (M) | Node drawer (intercepting route): Overview, Settings per provider (Shopify sync toggles and count push moved; Bosta zones, rates, pickup default and city aliases; WhatsApp read-only + link), Activity, Problems (grouped by cause, replay/resend/dismiss via §8.3), Danger zone; pseudo-nodes open the settlement view | CN-3a, A-11 (single recoveries) or an interim existing replay | e2e: open node → change a toggle → Back closes; flow budget (1 click to settings) | Every connection setting reachable by clicking its node; old pages redirect when the flag is on |
| CN-4b (S) **[WAITS: Studio, Template]** | WhatsApp drawer embeds `StudioSummary` (read-only) with "Edit in Studio" deep links per section | CN-4, the branches merged | Component test against the agreed export | Clicking the WhatsApp node shows all its settings |
| CN-5 (S) | Live topic `connections` (snapshot + deltas + immediate state events) | LV-1a, CN-3a | SSE test | Map updates within 5s without polling |
| CN-6 (M) | Locked data: typed `TenantView.brand`, "Follow the channel's name" setting, 409 `field_from_channel`, Woo profile read (connector, Resolver, `send()`, fake server), WhatsApp profile read (Resolver with ranked paths, fields `[CONFIRM]` against the pinned Graph version) in the engine **with a fake WhatsApp server and chaos cases for the profile read**, product `sourceOf`, `SourceField` | DS-4a | Engine tests + chaos (Woo and WhatsApp); API tests for 409 | Store name read-only while following Shopify; WhatsApp node shows the real number |
| CN-7 (S) | Platform map endpoint for staff | CN-2 | API test | Store-360 Integrations tab |

**Lane F: onboarding**

| ID | Scope | Depends on |
|---|---|---|
| OB-1 (M) | `(focus)` route group behind `onboarding_v2`; steps 1–4 on the mini FlowMap (catalogue tiles with logos, animated connect, import counter + `etaS`, Bosta guided key); strict-order true-state steps; the "Setup complete" map for finished stores | CN-3a (mini FlowMap export only, not the whole map), CN-2 (catalogue) |
| OB-2 (S) | Costs step, first-order moment, Extras sheets; product events per step; phone strip layout; live region; flow budget (landing → step 1 ≤3 screens) | OB-1 |
| OB-3 (S) | Trial chip and plan from the signup URL | E12-2a2 |

**Lane G: subscriptions** (owner defaults apply unless D3–D7 change them)

| ID | Scope | Depends on | Tests | Acceptance |
|---|---|---|---|---|
| E12-2a1 (M) | Schema + state machine: catalogue, `billing_settings`, subscriptions, `subscription_events`, `trials_used` + `claim_trial` and `coupons` + `redeem_coupon` as `SECURITY DEFINER` (no tenant grants), `platform_holidays`, `billing/state.ts` with version checks; **backfill of existing tenants** per D18 (pilots comped Scale; others per policy) | — | State machine edge tests, db RLS + definer-function isolation tests, backfill test (every tenant has one live subscription) | `tenants.plan` has one writer |
| E12-2a2 (M) | Signup and trial: `CreateTenantSchema` plan/interval, subscription in the tenant transaction, trial end in the store's time zone, `claim_trial` with platform-peppered HMAC keys | E12-2a1 | Signup transaction test; trial-abuse test (same phone/domain refused) | A new store starts `trialing` for 7 days (only once E12-2a3 is in: `trial_days` = 0 in production until then) |
| E12-2a3 (M) | Entitlements and readers: `@mizan/shared/plans.ts`, `@Entitled` guard (behind `entitlements`), the five `'trial'` readers, staff plan route through the service, **minimal `billing.scheduler` applying `end_of_trial` (`downgrade_free`)** | E12-2a2 | Time-travel test: day 7 → Free with orders still flowing | No trial can outlive day 7 |
| E12-2b0 (M) | **Manual billing first:** invoice pay by InstaPay/transfer/wallet receipt or a Brandita merchant-style pay link; receipt upload; admin manual payments queue and Mark paid; `payment_attempts.method='manual'/'pay_link'` | E12-2a3, E12-2c | API + admin e2e | A store can pay an invoice and become `active` with no token path |
| E12-2b (M) `[UNCONFIRMED]` | Engine Paymob automatic renewal: `createIntention({saveCard})`, `chargeToken` (merchant-initiated token charge, no PAN in Mizan), fake server quirks + chaos; platform webhook route through intake; inbox; token storage | **Written Paymob answers (§7.4)**, A-10a (hot-file order) | Chaos suite, HMAC tests | A charge is never re-sent blindly; a lost answer is resolved by inquiry |
| E12-2c (M) | Invoices, gapless numbering, tax lines, PDF AR/EN, credit notes, account credit | E12-2a1 | Numbering concurrency test, PDF snapshot AR | — |
| E12-2d (M) | Full scheduler: reminders (bell now; email after INF-1; WhatsApp after INF-2), dunning with the holiday table, grace/restricted, `read_only` end-of-trial option, pay links, reconcile, card expiry (after E12-2b) | E12-2a3, E12-2b0, E12-2c | Worker-loop tests, time-travel tests | Day 7 outcome follows `end_of_trial`; orders never stop |
| E12-2e (M) | Web: PlanPicker, checkout return, `/settings/billing` (receipt upload; saved card only after E12-2b), invoices, trial in LiveLine/BannerSlot/Today, `<Entitled>` previews, other-role variant | E12-2a3, SH-3a, SH-4 | e2e checkout with the fake Paymob pay link | — |
| E12-2f (M) | Admin: billing tab, subscriptions list, manual payments queue, dunning board, catalogue, coupons, revenue, billing settings, holidays, replay; price change fires the site rebuild hook (D20) | E12-2a1, DS-4c | e2e on the emulator stack | Owner can change trial days, end-of-trial behaviour and prices without a deploy; the landing shows a new price within about 10 minutes |
| E12-2g (S) | `usage_periods`, billable-order rule, incremental counters, overage lines, `UsageCloser` due-queue | E12-2a1 | Load test via `@mizan/perf` | Limit check off the per-order recount |
| E12-2h (L) | ETA e-invoice submission; issuer registration added as a **Gate 3 blocker in `docs/15`** | tax adviser sign-off | — | — |
| — | Turn gating on (`entitlements` flag per store) | E12-2a1–a3, E12-2b0, E12-2c, E12-2e merged, pilots comped | — | — |

**Lane H: Event Center**

| ID | Scope | Depends on |
|---|---|---|
| A-10a (M) | `event_intake` (partitioned, sealed bodies except privacy topics, retention, redaction purge), written in the same transaction as mark-and-enqueue for accepted hits and as `mizan_worker` for null-tenant hits; `IntakeRecorder` on every webhook route (WhatsApp as a wrapper only) | FX-3a, CN-1 (hot-file order) — db tests incl. PGlite partitioning + RLS |
| A-10b (M) | Correlation: nullable `correlation_id` columns defaulting to `current_setting('mizan.correlation_id', true)`, `SET LOCAL` in `withTenant`, `AsyncLocalStorage` in API, worker and dispatcher; `last_error_kind` / `cause_code`; `ops-causes.ts`; `JOB_SAFETY` with the "every kind declared" test | A-10a |
| A-10c (M) | `ops_timeline` + triggers with the `WHEN` filter, `OpsTap`, client-error sink `POST /v1/ops/client-errors` (rate-limited, scrubbed), `ops_device` rows from `/v1/ops/sync`, outbound `lost` checks in the guardian, R1 archive job | A-10b — `@mizan/perf` write-amplification check |
| A-11 (M) | Recovery registry (validate + record + enqueue owner job or emit `recovery.requested`; owners answer `recovery.completed`) + single recovery endpoints (platform + `/v1/ops`), `automation_runs` re-run change, admin `/events` with lanes, filters, search, chain drawer, cause card, DTO tenant/connection renames | A-10c, DS-4c |
| A-12 (M) | Bulk recovery batches + preview, incidents, alert rules (incl. M3, lost writes, client and device spikes), `AlertEvaluator`, alert deliveries (in-app + staff webhook now; email after INF-1; WhatsApp after INF-2); guardian writes `recovered` rows and only revives retryable domain events | A-11 |
| A-13 (M) | Support cases (staff `/cases` in the CS route group + merchant `/support` as a live thread on the LV-1 `support` topic), access tied to cases with auto-end, store-360 tabs | A-11, SH-3a, LV-1a |
| A-14 (S) | Merchant Activity (`/connections/activity`, order Sync history), `/v1/ops/flow` feeding map edges | A-11, CN-4 |
| A-15 (S) **[WAITS: Studio, Template]** | The confirmation module's `recovery.requested{resend_message}` consumer, agreed with the branch owners; the re-send action enabled; verify `correlation_id` is populated on `confirmation_steps` / `whatsapp_messages`; move WhatsApp webhooks to verify → intake → enqueue → 200 (W11 debt) | the branches merged |

**Lane I: landing**

| ID | Scope | Depends on |
|---|---|---|
| L1-9a (S) | Port the Brandita components into `packages/ui` (header landing tones, footer, cursor and attach, spotlight, Liquid kit, Figures) + gallery | DS-2 |
| L1-9b (S) | `apps/site` scaffold (static export, fonts, tokens, locale picker, messages and tests moved, lint) **+ the legal routes `legal/[doc]/` with content moved from `apps/web/content/legal`** | DS-1 |
| L1-9c (M) | Sections 1–4, 15, 16 + `LandingDirector` and cursor/reveal as vanilla module scripts (uses the FlowMap demo mode); JS budget check (≤140KB total, islands ≤45KB) in CI | CN-3a FlowMap (or its demo-only first cut), L1-9a/b |
| L1-9d (M) | Sections 5, 6, 8, 9, 10 (payments values generated from `cashToCollect`) | L1-9c |
| L1-9e (S) **[WAITS: Studio, Template]** | Section 7 with the `WhatsAppPhone` style-agnostic core and the template catalogue (static fallback can ship earlier in L1-9d) | the branches merged and the core exported |
| L1-9f (S) | Pricing on `@mizan/shared/plans.ts` + `/v1/public/plans` at build time, the `site.rebuild` hook (D20), 7-day trial copy, signup params, `SITE_SHOW_PRICES` | E12-2a3 |
| L1-9g (S) | SEO (OG via `next/og` on static routes, confirmed with Next 16 in acceptance, else build-script PNGs; JSON-LD, sitemap, robots), Lighthouse CI budget | L1-9c |
| L1-9h (S) | Infra (Terraform static host, `deploy-site.yml`, DNS runbook), then delete `(marketing)`, `lib/marketing.ts` and the proxy branch. **Blocker: every footer legal link resolves on `apps/site`, and the app's old legal URLs redirect there** | L1-9g, owner D9 |

**Lane J: ops app (`apps/ops`, Flutter)**

| ID | Scope | Depends on | Tests | Acceptance |
|---|---|---|---|---|
| OP-1 (S) | Regenerated `mizan_tokens.dart` + `design_system_copy_test.dart`; theme in `lib/theme` | DS-1 (same PR or right after) | Flutter test suite | Ops suite green with the 2026-10 palette |
| OP-2 (M) | Offline status bar (queued N, syncing, last sync), queue screen restyle, conflict/reject sheet per item; the sync endpoint records rejects as `ops_device` events | OP-1, A-10c for the server side | Widget tests AR/EN; chaos-tested sync stays green | A warehouse user always sees what is waiting and can resolve a conflict without the office |
| OP-3 (M) | Count, pick/pack and receive screens in the new look: dock nav, 56px+ targets, haptics, scan frame, Western-digit quantities, AR/EN; sign-in (E8-4b) visual shell | OP-1 | Widget tests per screen; existing flow tests green | Each scan job doable with one thumb |

**Lane K: infrastructure dependencies**

| ID | Scope | Depends on | Acceptance |
|---|---|---|---|
| INF-1 (M) | Transactional email: provider **[CONFIRM]** (default Azure Communication Services Email, UAE-region data policy checked against `docs/09`), sender domain (SPF/DKIM/DMARC), a `MailService` with templates in AR/EN, outbox-backed sends, bounce handling, secrets via Key Vault | owner picks the domain | A test email from staging; no PII in logs |
| INF-2 (M) | The Brandita WhatsApp Business account for Mizan's own messages: WABA + number, utility templates (trial reminders, payment failed, case reply, incident) submitted for approval, a platform sender service (outbox job, separate from merchants' connector config) | owner: Meta business verification | Approved templates; a reminder delivered on staging |

Unblocks: E12-2d email/WhatsApp reminders, A-12 email/WhatsApp alerts, A-13 email copies of replies, the dunning board's send actions.

**Lane L: cleanup**

| ID | Scope | Depends on | Acceptance |
|---|---|---|---|
| CLN-1 (S–M) | Delete the old `SyncIndicator`, `MobileNav`, `PlanBanner`, `IntegrationsScreen`, `StoreSyncScreen`, `EngineHealth`, `SetupChecklist`, the `components/ui` and admin shims, the old health route, `/usage/upgrade`, rollout flags that are on everywhere | SH-4, CN-4, SH-6, DS-4c, all pilots on v2 for two weeks | A dead-code check (`ts-prune`-style script or `knip`, pinned) shows none of them referenced; all suites green |

### 11.2 Suggested start order

Aligned with `docs/15` (launch work first; 30% on pilot fixes from week 5). Parallel where files don't overlap; arrows are hard dependencies.

- **Weeks 1–2 (L0/L1, go-live helpers first):** FX-1, FX-2, FX-3a → FX-3b, DS-1 + OP-1, DS-3, SH-2 (API part: inbox), LV-1a, E12-2a1, INF-1 and INF-2 started (both have owner lead times). SH-0 starts once both open branches have merged, or in its partial form (hands-off namespaces left in place) if they are still open at the end of week 1.
- **Weeks 2–4:** CN-1 (after FX-3) → A-10a (hot-file order) ; DS-2 → DS-4a → DS-4b → DS-4c; E12-2a2 → E12-2a3; E12-2c.
- **Weeks 4–6 (L2/L3):** SH-3a (behind `shell_v2`, off for pilots) → SH-4, SH-3b; LV-1b; CN-2 → CN-3a → OB-1 (mini FlowMap) and CN-4; A-10b → A-10c; E12-2b0 (manual billing, needed before Gate 3); SC-13, SC-2, SC-1a in parallel; OP-2.
- **Weeks 6–10 (L3/L4):** remaining SC items by area (SC-1b/c, SC-4, SC-5, SC-6, SC-7 …, SC-17a/b/c, SC-A); CN-3b, CN-5, CN-6, CN-7; A-11 → A-12 / A-13 / A-14; E12-2d, E12-2e, E12-2f, E12-2g; OP-3; L1-9a/b → L1-9c/d/f/g → L1-9h.
- **When Paymob answers arrive in writing:** E12-2b (after A-10a on the hot files).
- **After the Studio and Template merges:** SH-6, SC-1d, CN-4b, the richer SC-4 script, A-15, L1-9e.
- **Last:** CLN-1, after every pilot has run on v2 for two weeks with the owner's OK.

Pilot flag flips (owner, per store, from admin Flags): `connections_map` and `onboarding_v2` first (low workflow risk), `shell_v2` and `screens_v2.*` after L4 or when a pilot asks, `entitlements` only after pilots are comped.

### 11.3 Docs to update along the way

| Doc | Change |
|---|---|
| `DESIGN.md`, `docs/08-design-system.md`, `packages/design-system/docs/components.md` and `glass.md` | Navigation, sheet, motion, palette |
| `docs/03` | Correlation, intake, live SSE, `apps/site`, the tenant-vs-connection naming note |
| `docs/15` | Rollout flags per pilot, the redesign lanes in the feature track, ETA issuer registration as a Gate 3 blocker, INF-1/INF-2 owner tasks |
| `docs/04` | All new tables |
| `docs/05` | Every endpoint above; retire `/usage/upgrade` |
| `docs/06` | Billing Paymob, Woo and WhatsApp profile reads |
| `docs/07` | Intake PII, sealed bodies (never for privacy topics), tokens, locked fields, platform peppers (`TRIAL_KEY_PEPPER`, `OPS_CUSTOMER_PEPPER`), the Customers search blind index, client-error scrubbing, SSE token handling |
| `docs/09` | New alerts and runbooks ("secret rotated", "webhooks silent", "dead event"); the site deployable; INF-1 email and INF-2 WABA; log config stripping `token` |
| `docs/12` §8 | Billing token |
| `docs/13` | Integration, billing and recovery events; automation re-run semantics |
| `docs/01` §8 | Trial and the Free decision |
| `docs/legal/terms` | Trial, renewal, grace, auto-renew consent |
| `docs/10-backlog.md` | All IDs above |

---

## 12. Open decisions for the owner

Each decision has a recommended default. Work proceeds on the default unless the owner changes it.

| # | Decision | Recommended default | Changeable later? |
|---|---|---|---|
| D1 | Palette: adopt Brandita's 2026-10 palette (ink `#131313`, bone `#F5F4F1`, red `#D63233`) across Mizan, or keep the PDF kit (lavender paper, `#DE0000`)? | Adopt 2026-10 (one brand); red text stays darker for contrast. App motion takes the navlink, tick, roll, dock and easing; the Brandita cursor, attach, pour and Liquid kit stay landing-only | Yes (tokens) |
| D2 | Fonts: keep Geist / IBM Plex Arabic / Alexandria (adding Geist 800/900), or switch to Brandita's Inter / Cairo? | Keep Mizan's fonts everywhere, landing included | Costly |
| D3 | After the 7-day trial, without payment: downgrade to a limited Free plan, or read-only until paid? And is Free sold publicly? | Downgrade to Free (orders keep flowing, paid screens become locked previews for 30 days); Free not sold publicly | Yes (admin `billing_settings`) |
| D4 | Card needed to start the trial? | No card in Egypt; optional "add now" (once E12-2b exists); per-currency switch. Assumption, not data: low card use among Egyptian merchants makes a card wall cost sign-ups | Yes (admin) |
| D5 | How the launch offer (first 50 get 3 months free) combines with the trial | Trial for everyone; `LAUNCH50` by invitation only, not on the landing | Yes (coupons) |
| D6 | Publish prices on the landing now? | Behind `SITE_SHOW_PRICES` until the pilots confirm the proposed prices (Growth EGP 2,500 / $99, Scale EGP 6,500 / $299) | Yes (flag; prices editable in admin) |
| D7 | GCC billing: currency (USD vs SAR/AED), provider (Paymob UAE vs Tap vs a merchant of record) and issuing entity | USD via the provider chosen with the entity decision; SAR price rows when the KSA entity exists | Yes |
| D8 | Partner logos: full colour or mono? And written permission from Bosta, Paymob, Mylerz, J&T, Salla, Zid, Tabby, Tamara | Full colour on neutral tiles in the map and onboarding, mono in tables and the landing (colour on hover); monograms until permission arrives | Yes |
| D9 | Landing as a separate static site (`apps/site` on a CDN) or kept inside the app | Separate | — |
| D10 | Product prices edited in Mizan: two-way, where a later store change wins (today's behaviour), or a Mizan price lock that pushes back? | Two-way, store wins; remove the false "put back" copy now; revisit after pilots | Yes |
| D11 | Overage prices (EGP 0.75 / 0.50 per order) and whether cancelled orders count as billable | As listed; cancelled orders count, stated on the pricing page | Yes (price book) |
| D12 | WhatsApp, SMS and AI usage: the merchant pays Meta directly, or Mizan bills at cost plus margin? | Merchant pays Meta directly (own WABA); billed pass-through as an optional per-store setting | Yes (per store) |
| D13 | Channel-owned store name: locked while following the channel, with an opt-out "Name in Mizan"? | Yes: follow by default (on), the owner can switch it off per store | Yes (per store) |
| D14 | Pilots: move to comped Scale for 3 months before feature gating starts? | Yes | — |
| D15 | Demo CTA: which WhatsApp number, and should a booking page exist? | WhatsApp with a prefilled message; the number in one constant | Yes |
| D16 | Brandita bundle discount percentage for ad clients | Commercial sets it (Gate 1); built as a coupon | Yes (coupons) |
| D17 | Remove the side rail in favour of the Brandita top bar? | Top bar everywhere; an optional 64px icon rail at ≥1280 as a per-user setting (off by default); the whole shell behind the `shell_v2` per-store flag, off for pilots until the owner turns it on | Yes (flag, per user) |
| D18 | Existing non-pilot stores (staging, test, early sign-ups) when subscriptions launch | A fresh 7-day trial from the deploy date; alternative: grandfather them as Free | Yes (staff can grant or end trials) |
| D19 | Customer-service panel: a route group inside admin or a separate app? | A role-scoped CS route group inside `apps/admin` (one staff identity, one audit trail); merchants get a live support thread in `/support` | Costly to split later, cheap to start inside |
| D20 | Landing prices: baked at build time or fetched at runtime? | Build time from `/v1/public/plans`, with an automatic site rebuild when the price book changes (static, no API dependency, strict CSP) | Yes |
| D21 | Transactional email provider and sender domain (INF-1); Brandita WABA number (INF-2) | Azure Communication Services Email on a `mizan` subdomain; a dedicated Brandita number for Mizan's own messages | Yes |

---

## Appendix A. Critique decisions (revision 2)

**Accepted and applied** (section in brackets):
- Scope: ops app lane (§4.25, Lane J OP-1…3); every admin page specified (§4.24, SC-A); flow budgets with a Playwright test (principle 11, Lane D note); landscape, coarse-pointer, foldable, keyboard rules (§3.2, FX-1 contract); onboarding true-state order and the finished-store map (§6); WhatsApp drawer `StudioSummary` (CN-4b, §0); D17 rail decision with an optional ≥1280 rail; ViewTransition as progressive in SC-1b/SC-2; cursor landing-only recorded in D1; Payments COD pseudo-node and launch content per sector (§5.2).
- Trial and billing: existing-store backfill (D18, E12-2a1); Enterprise and Free stated as reinterpretations (§7.2); minimal end-of-trial scheduler inside E12-2a3 and `trial_days` = 0 until then; manual billing E12-2b0 first; the whole token path `[UNCONFIRMED]`; "MOTO" replaced by "merchant-initiated token charge", no PAN through Mizan; save-card endpoint out of E12-2e acceptance; holiday table; INF-1 email and INF-2 WABA as dependencies (Lane K).
- Event capture: client-error sink, `ops_device` rows, outbound `lost` checks, W3/W4, W5, W6, W8, W9, J3, E5, R1, M3, W11 as logged debt, naming note (§8.1, §8.2, FX-3a/b, A-10c).
- Rules: `claim_trial` / `redeem_coupon` as `SECURITY DEFINER` with no tenant grants (rule 9); platform-peppered HMACs for trial keys and customer keys, and the existing `customers.phone_hash` blind index for Customers search (rule 12); privacy topics never sealed; SSE token single-use, bound and stripped from logs; recoveries dispatch by owner jobs or `recovery.requested` events (rule 14); correlation ids filled by a column default from `current_setting`, so no hands-off code changes; trigger `WHEN` filter + perf check; intake in the same transaction, activity aggregated in memory; null-tenant intake via `mizan_worker` + PGlite test; FX display rounding only (rule 8); SH-0 leaves the hands-off namespaces in place; the 20 B1 files listed + ESLint rule; mono logos only as brand-provided black/white files; per-direction path generation with snapshots.
- Milestones: re-export shims (DS-4a); SH-1 reduced so each SC owns its headers; A-6 flags and §11.0b go-live coupling; splits SC-1a–d, SC-17a–c, A-10a–c, E12-2a1–a3, CN-3a/b, FX-3a/b, LV-1a/b, SH-3a/b, DS-4a–c; OB-1 on the mini FlowMap; LV-1a in week 1; hot-file owner order FX-3 → CN-1 → A-10a → E12-2b; e2e suite maintenance; CLN-1; WhatsAppPhone style-agnostic core; `packages/ui` styling scope.
- Motion and performance: WAAPI transform particles with coarse caps; solid cards on coarse pointers; `::after` row flash; the one stated row-collapse exception; dock springs only on tab change; dialog exit progressive; landing JS budget 140/45KB with vanilla scripts; badge roll throttle; SSE closes on `pagehide`/`freeze` and respects `saveData`; iPad hardware check.
- Third-party claims: Paymob items `[UNCONFIRMED]`; Simple Icons slug check script; per-brand `allowedVariants`/`minPx`/`guideUrl`; Lucide claim dropped; Shopify App Store 2026 check; Meta fields via `Resolver` + `[CONFIRM]` + fake server and chaos; SSE through Front Door smoke test; `next/og` under static export in L1-9g acceptance; ETA issuer registration as a Gate 3 blocker; the D4 card claim labelled an assumption.
- Audit leftovers: PF-1 prefetch and placeholder/persisted cache, SH-9 landmarks, admin e2e after DS-4c, X9 catalogue-driven lists, KPI hints 1.7, audit entity labels 9.8, dark island edge, dock short labels with a ≤12ch test, one `formatMoney`, Western digits everywhere (plan copy fixed), health route removal date, Bosta pickup locations and city aliases in `GET /v1/connections/{id}`.

**Rejected or changed** (with reason):
- **"Order E14-2c (Paymob merchant connector) before CN-3."** Rejected. Pilots are COD-first (`docs/15` §1) and Paymob facts are unconfirmed; making the map wait on a payments connector delays the owner's most visible ask. The COD-via-couriers and "recorded by the team" pseudo-nodes fill the Payments sector at launch instead.
- **"Make SSE tokens single-use" taken literally with native `EventSource`.** Changed: native auto-reconnect reuses the URL and would always fail on a used token. The hook closes on error and mints a new token per reconnect, which keeps single-use workable.
- **"Put ViewTransition in SC-1/SC-2 acceptance"** vs **"don't make it an acceptance criterion".** The two critique points conflict; resolved as: implemented in SC-1b/SC-2, verified where supported, never blocking.
- **"Collapse with opacity + `scaleY`".** Not taken: `scaleY` distorts the row's text during the animation and still leaves a layout jump at the end. The accepted alternative (fade, then `grid-template-rows` for one row at a time, with no animation for batches) is stated as the single exception.
- **"Fetch prices at runtime OR rebuild the site on change: pick one."** Picked build time + rebuild hook (D20); the runtime option is kept only as the recorded alternative.
- **"`offset-distance` runs on the main thread in Chromium."** Not verified here and kept as `[CONFIRM]`; the WAAPI transform approach is adopted anyway because it is compositor-only on every engine whatever the answer.
- **"Hide the dock at `max-height: 500px`" for every device.** Narrowed to landscape orientation, so short portrait windows (split-screen on tablets) keep their navigation.
