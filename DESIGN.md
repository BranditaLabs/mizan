---
version: 1
name: Mizan
description: Mizan (ميزان) by Brandita — the commerce operating system for MENA brands. Ink on paper, flat surfaces, one red point: the two-ball mark (ink left, red right, like scale pans). Arabic first (RTL), English equal. Calm, dense, premium ops UI where the profit number leads.
source_of_truth: packages/design-system (tokens/tokens.json → dist/tokens.css, dist/tailwind.css). This file summarises it for AI agents; if they differ, the package wins.

colors:            # light theme; dark values in dist/tokens.css ([data-theme="dark"])
  bg: "#FEF7FF"           # paper
  surface: "#FFFFFF"
  surface-sunk: "#F5EEF6"
  line: "#EDEDED"
  line-strong: "#D9D9D9"
  text: "#0B0B0B"          # ink
  text-2: "#545454"
  text-3: "#6B6B70"
  primary: "#0B0B0B"       # primary actions are ink, never red
  on-primary: "#FFFFFF"
  brand: "#DE0000"         # the one red point
  danger: "#DE0000"
  success: "#1BAF7A"
  warning: "#EDA100"
  info: "#2A78D6"
  dark:
    bg: "#0B0B0B"
    surface: "#141415"
    text: "#F7F3F8"
    primary: "#F7F3F8"
    brand: "#EA4643"

typography:
  latin: "Geist"                    # UI and display
  arabic-display: "Alexandria"      # Arabic headings; the Arabic wordmark is logo/svg/mizan-wordmark-ar.svg (outlined)
  arabic-body: "IBM Plex Sans Arabic"
  mono: "Geist Mono"                # order IDs, SKUs, tracking numbers, phones
  weights: [400, 500, 600, 700, 800, 900]   # Geist 800/900 for Brandita's display voice
  scale: [display-*, heading-lg, heading-md, heading-sm, body-lg, body, body-sm, label, caption, overline, kpi, kpi-sm, mono, display-hero, kicker, nav-link]

shape:
  radius: { xs: 4px, sm: 6px, md: 8px, lg: 12px, xl: 16px, pill: 9999px, island: 20px, island-lg: 28px }   # pill: top bar, dock, chips; island: ink islands only
  elevation: flat            # no shadows on cards, buttons or shapes; only menus, dialogs, toasts use shadow-overlay
  glass: mizan-glass        # the web app renders through css/glass.css (docs/glass.md) via css/glass-bridge.css: frosted surfaces, light fields, rim light (owner's decision, Oct 2026)

motion:                    # ported from the Brandita site (docs/16 §2.3)
  properties: [transform, opacity]
  durations: { instant: 80, fast: 150, base: 200, slow: 300, moderate: 450, glide: 600, reveal: 900, drift: 24000 }   # ms
  easings: [enter (= --mz-ease), expand (= --mz-ease-sheet), exit, standard, spring, spring-soft, pour]
  enter: 200ms ease-enter
  exit: 150ms ease-exit
  press: scale(var(--mz-press-scale))   # 0.98 everywhere
  reduced-motion: every duration ≤120ms (drift 0), distances 0; gentler, never removed feedback
  island: shadow-island (1px rim + soft glow) keeps an ink island apart from the dark canvas
  brand-2.0:               # docs/08 §2a; screens never pick an animation: they name the event, the catalogue decides
    rules: { tip: "2.6s loop, ±18° (hold 8°)", merge: "neck in 380ms, nothing snaps", settle: "720ms cubic-bezier(.34,1.32,.5,1)", drop: "red falls once 620ms, ripple 1.4s; only when confirmed" }
    loaders: { pair: loading (default), transfer: syncing two systems, drop: saving or confirming, fill: known progress }
    catalogue: packages/shared/src/motion (EVENT_MOTION; ops app copy in apps/ops/lib/motion/event_motion.g.dart)
    red: once per view; the chrome uses mono marks; reduced motion shows still frames

partner-logos: "<PartnerLogo slug=… /> from @mizan/design-system/partners/react (web: components/ui/PartnerLogo). Real marks only (logos/partners/partners.json), never recoloured; a monogram tile otherwise"

icons: "<Icon name=… /> from @mizan/design-system/icons — 18px, stroke 1.75; directional icons mirror in RTL"
---

# Mizan design language

## Feel
Calm and premium: ink on paper, generous but dense where work happens, flat surfaces. Colour is for **status only**. **Red is a scalpel, once per view** — the mark's right ball, the active navigation indicator, the one number that matters on a screen, and errors. Never a red button, never decorative red.

## Principles
1. **Profit first.** Every screen answers "is this making money?"; on the home screen the profit number comes first.
2. **Queues, not reports.** Ops screens show what needs action next, sorted by urgency, with counts on tabs.
3. **One primary action per screen** (ink button); secondary actions in menus.
4. **Mobile-first for ops** (agents and warehouse on phones); owners check profit on phones.
5. **Arabic is not a translation.** Design in Arabic first (Egyptian Arabic for merchant copy: "أكّد الأوردر"), check English second.

## Bilingual and RTL (non-negotiable)
- `dir="rtl"` for Arabic; logical properties only (`ms-* me-* ps-* pe-* start-* end-* text-start`), never left/right.
- Numbers, phones, order IDs, SKUs, tracking numbers and URLs inside Arabic text go in `<Bdi>` (amounts, tabular) or `<Bdi code>` (Geist Mono, LTR).
- Western digits by default; amounts via `Intl.NumberFormat` with the store's locale: `EGP 1,150` / `1,150 ج.م`.
- Every string through next-intl (`messages/ar.json`, `messages/en.json`); lint blocks literal UI strings and physical directions.

## Components
Use the kit in `apps/web/src/components/ui` (gallery at `/ar/ui`, `/en/ui`) and recipes in `packages/design-system/docs/components.md`: tables with sticky headers and status pills, KPI tiles, filter tabs with counts, empty states with one action, skeleton rows while loading, problem toasts for API errors, dialogs for confirmations that move money or stock.

## Don't
- The web app is on **Mizan Glass** (`packages/design-system/css/glass.css`, `docs/glass.md`): a `.mzg` root (dark; `.light` for paper) with drifting light fields, and `css/glass-bridge.css` mapping the core tokens and `.mz-*` components onto it, so screens keep using the core classes. Ink islands (the dashboard hero, the sign-in brand side) stay dark glass in either theme. Glass relaxes the "no shadows" rule inside `.mzg` only. Still no stock illustrations; red stays for meaning.
- No hex values or non-token classes in components (a unit test fails on them).
- No red primary buttons; no colour that carries meaning without a label or icon.
- Don't redesign the identity: refinements keep ink, paper and the red point.
- Don't pick an animation on a screen: name the event (`useEventMutation`, `toast.event`, `EventLoader('ops.syncing')`) and the catalogue plays its outcome. No spinners, no ad hoc keyframes, no red outside the budget (lint: `mizan/no-adhoc-motion`, `mizan/no-brand-red`; Flutter: no `CircularProgressIndicator`).

## Motion (Brand 2.0)
Four rules from the brand pack: **TIP** (two sides compare by rising and falling), **MERGE** (agreeing values flow into one), **SETTLE** (arrive with a small overshoot), **DROP** (the red enters from above once, only when something is confirmed). Loaders by meaning: pair = loading, transfer = syncing, drop = saving or confirming, fill = known progress. Every event has one outcome (settle, done, merge, tip, fail, drop or quiet) in `packages/shared/src/motion`, shared by web, admin and the ops app. Reduced motion shows a deliberate still frame, never a slower loop. Details: `docs/08-design-system.md` §2a, the table in `docs/13` §2.1.
