# Mizan Glass — the premium layer

`css/glass.css` is an optional layer on top of the core system. It renders Brandita's ink, paper and red as **light seen through frosted glass**: translucent surfaces with a specular rim, slow fields of light behind them, and motion that weighs and settles. Use it for the web dashboard (`apps/web`), the marketing site and the ops app splash.

Design reference: the "Mizan Glass" canvas (dashboard, components, loaders, foundations, Arabic mobile).

## What stays from the core system

- **Primary actions are ink** (paper on dark). Red is used only for meaning: the active indicator, the one number, warnings, losses. `btn-red` is for at most one commercial moment per screen.
- Status always has a text label. Numbers are tabular. IDs and phones are LTR inside Arabic (`.mono`).
- Arabic is never tracked or uppercased; `dir="rtl"` on the root switches to IBM Plex Sans Arabic and Alexandria.
- **What changes:** the core rule "no shadows" is relaxed inside `.mzg` only. Depth comes from blur, rim light and soft shadows.

## Setup

```css
@import "@mizan/design-system/tokens.css";
@import "@mizan/design-system/fonts.css";
@import "@mizan/design-system/glass.css";
```

```tsx
<div className={cn("mzg", theme === "light" && "light")} dir={locale === "ar" ? "rtl" : "ltr"}>
  <div className="fields" aria-hidden><i className="f1" /><i className="f2" /><i className="f3" /><div className="dots" /></div>
  {/* app */}
</div>
```

`.mzg` is dark by default, and `.mzg.light` is the paper theme. Fields need `position: relative` on the root, which `.mzg` provides.

## Surfaces

| Class | Use |
| --- | --- |
| `.g` | Cards, rail, header. Blur 24, rim light, radius 20. |
| `.g-2` | Insets inside a card: rows, tiles, flow nodes, radius 14. |
| `.g.g-solid` | Floating layers: menus, command palette, toasts, tooltips (blur 32, more opaque). |
| `.g-lift` | Stronger shadow for floating layers. |
| `.hero-tile` + `<span class="halo">` | The one KPI the screen exists for, lit by a breathing red halo. |
| `.spot` | Pointer-following light. Set `--mx`/`--my` on `mousemove` (see below). |

```ts
const spot = (e: React.MouseEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
};
```

## Components

| Component | Markup |
| --- | --- |
| Buttons | `.btn` + `.btn-primary` (ink/paper, sheen on hover) · `.btn-glass` · `.btn-ghost` · `.btn-red` · sizes `.btn-sm` `.btn-lg` · `.btn-icon` |
| Segmented | `.seg` > `.seg-thumb` (width = button width, `transform: translateX(index × width)`) + `button[aria-pressed]` |
| Fields | `.field` > `.label` + `.input` (+ `aria-invalid`) + `.hint` / `.err` |
| Switch | `button.switch[role=switch][aria-checked]` |
| Status | `.chip` + `ok` · `info` · `warn` · `bad` (glowing dot) · `.chip.plain` |
| Payment tag | `.tag` with a 14px icon |
| Keys | `.kbd` |
| Live dot | `.live` (green ping) · `.live.red` (needs you) |
| Navigation | `.nav` > `.nav-ind` (`transform: translateY(offset)`, spring) + `.nav-item[aria-current=page]` + `.nav-count`; section labels `.nav-label` (34px); items are 38px |
| Table | `.tbl` (or a grid of rows on a glass card) |
| Toast / tooltip | `.g.g-solid.toast` · `.g.g-solid.tooltip` |
| Skeleton | `.skel` (shimmer) |
| Type | `.disp` display · `.num` tabular · `.mono` IDs · `.eyebrow` · `.muted` · `.faint` |

## Motion

| Class | Effect |
| --- | --- |
| `.rise` (+ `--d` delay) | Page entrance: fade, rise 16px, unblur. Stagger cards 50ms apart. |
| `.draw` + `pathLength="1"` | Chart lines draw in. |
| `.fade-in` | Chart areas and markers. |
| `.grow-x` | Bars grow from inline-start (mirrors in RTL). |
| `.seg-in` | Donut segments spring in. |
| `.slide-in` | Rows and feed items. |

Curves: `--ease-out` (enter), `--ease-io` (charts, loaders), `--ease-spring` (thumbs, switches, the red point). Only opacity and transform animate. `prefers-reduced-motion` turns entrances off; loaders show their still frame (never a slower loop).

## Loaders

Brand 2.0 replaced the glass loaders (`.ld-scale`, `.ld-word`, `.ld-orbit`, `.ld-rail`, `.ld-bars`, `.ld-ring` are gone).
Every wait is `MizanLoader` from `@mizan/design-system/react/motion`, one kind per meaning:

| Kind | Meaning | Where |
| --- | --- | --- |
| `pair` | A page or its data is loading | `PageState`, `BootLoader`, the outage screen |
| `transfer` | Syncing or reconciling two systems | The sync pill, onboarding checks, a busy button whose event syncs |
| `drop` | Saving, confirming, sending | Busy buttons (the default) |
| `fill` | Known progress | `FillProgress`: bulk actions, onboarding, purchase orders received |

Screens never pick one: a busy button reads its event's `pending` from the catalogue (`@mizan/shared/motion`).
Keyframes and the one reduced-motion block are in `css/motion.css`. Lint (`mizan/no-adhoc-motion`) blocks the old classes.

Skeletons (`.skel`, `.mz-skeleton`) are still (no shimmer), with a 20 px pair beside them, for content that is about to appear.

## Flutter (ops app)

Glass in Flutter is `BackdropFilter(filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24))` over a `DecoratedBox` with a 7%→3% white gradient and a 1px border at 8% white. Keep the light fields as two blurred circles in a `Stack` behind the content and animate them with a 24–32s `AnimationController` that reverses. The splash is the Brand 2.0 mark (BR-3 adds the Lottie pair loader).
