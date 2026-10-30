---
version: 1
name: Mizan
description: Mizan (ميزان) by Brandita — the commerce operating system for MENA brands. Ink on paper, flat surfaces, one red point. Arabic first (RTL), English equal. Calm, dense, premium ops UI where the profit number leads.
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
  arabic-display: "Alexandria"      # Arabic headings, Arabic wordmark
  arabic-body: "IBM Plex Sans Arabic"
  mono: "Geist Mono"                # order IDs, SKUs, tracking numbers, phones
  scale: [display-*, heading-lg, heading-md, heading-sm, body-lg, body, body-sm, label, caption, overline, kpi, kpi-sm, mono]

shape:
  radius: { xs: 4px, sm: 6px, md: 8px, lg: 12px, xl: 16px }
  elevation: flat            # no shadows on cards, buttons or shapes; only menus, dialogs, toasts use shadow-overlay
  glass: ink-only           # .mz-glass tiles over the ink hero, with the brand glow (.mz-orb) behind; never on paper cards (owner's decision, Oct 2026)

motion:
  properties: [transform, opacity]
  enter: 200ms ease-enter
  exit: 150ms ease-exit
  reduced-motion: gentler, never removed feedback

icons: "<Icon name=… /> from @mizan/design-system/icons — 18px, stroke 1.75; directional icons mirror in RTL"
---

# Mizan design language

## Feel
Calm and premium: ink on paper, generous but dense where work happens, flat surfaces. Colour is for **status only**. **Red is a scalpel** — the logo's point, the active navigation indicator, the one number that matters on a screen, and errors. Never a red button, never decorative red.

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
- No gradients, drop shadows on cards, or stock illustrations. Glass only on the ink (`.mz-glass` over `.mz-orb`, the brand's red point as light): KPI tiles on the dashboard's hero. Never glass on paper surfaces, never as decoration without something behind it.
- No hex values or non-token classes in components (a unit test fails on them).
- No red primary buttons; no colour that carries meaning without a label or icon.
- Don't redesign the identity: refinements keep ink, paper and the red point.
