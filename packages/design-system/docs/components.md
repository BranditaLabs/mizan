# Components and UX rules

Every component exists as a reference class in `css/components.css` (`mz-*`) and is shown live in `reference/index.html`. In `apps/web`, build React components that reproduce these exactly, using the Tailwind recipes below (token names from `dist/tailwind.css`). Do not invent new colours, sizes or radii: if something is missing, add a token first.

## 1. Screen anatomy

```
┌ rail 232px (ink, always dark) ┐┌ header 56px · search ⌘K · notifications · avatar ─────────────┐
│ wordmark (svg, on-dark)       ││ page: max 1440px, padding 24 (16 on mobile), gap 20            │
│ sections: Operate · Money ·   ││  title row: page title (headingLg/24) + actions (secondary…primary)│
│   Platform                    ││  summary: KPI tiles (hero tile first, ink)                       │
│ nav item 34px, icon 17        ││  tabs with counts                                                 │
│ active: rail-surface + 2px    ││  data: table (sticky header) ─────────────┐ side panel 320–440px │
│   red-hi bar at inline-start  ││                                            │ (drawer on mobile)  │
└───────────────────────────────┘└────────────────────────────────────────────┴─────────────────────┘
```

- **One primary action per screen** (ink button, top end of the title row). Secondary actions are `secondary` or `ghost`; rare actions go in the `more` menu.
- **Summary before detail:** KPIs, then tabs, then the table. The hero KPI is the number the screen exists for.
- **Queues, not reports:** default sort is "needs action first" (oldest pending, highest risk, SLA breached).
- **Mobile (< 640px):** rail hidden (bottom bar or menu), side panel becomes a full-height drawer, tables scroll inside their container, tabs scroll horizontally, hero KPI spans the full row.

## 2. Buttons

| Variant | Use | Tailwind recipe |
| --- | --- | --- |
| `primary` | The one main action | `h-9 px-3.5 rounded-sm bg-primary text-on-primary hover:bg-primary-hover text-label` |
| `secondary` | Other actions | `h-9 px-3.5 rounded-sm bg-surface border border-line-strong text-text hover:bg-surface-hover` |
| `ghost` | Low emphasis, toolbars | `h-9 px-3.5 rounded-sm text-text-2 hover:bg-surface-hover hover:text-text` |
| `brand` | Max one per screen, commercial moments (Upgrade) | `bg-brand text-on-brand hover:bg-brand-hover` |
| `danger` | Destructive, outside dialogs | `bg-surface border border-line-strong text-danger-text hover:bg-danger-soft hover:border-danger` |
| `danger-solid` | Confirm button inside a destructive dialog only | `bg-danger text-on-brand` |

Sizes: `sm` 32px · `md` 36px (default) · `lg` 44px (touch, ops app, onboarding). Icon 16px, gap 8px. Icon-only buttons need `aria-label`. Press feedback: `active:scale-[.99]`. Loading: keep width, swap label for a 14px spinner, `aria-busy="true"`.

## 3. Fields

- Label above (13/500), hint below (12, text-3), error replaces hint (12/500, danger-text, `error` icon) and sets `aria-invalid="true"` + `aria-describedby`.
- Input: `h-9 px-3 rounded-sm border border-line-strong bg-surface text-body placeholder:text-text-3 hover:border-text-3 focus-visible:border-focus focus-visible:ring-1 focus-visible:ring-focus`.
- Phones, amounts, IDs: add `mz-num` (tabular, LTR inside Arabic). Accept Eastern Arabic digits; normalize on blur.
- Errors say what happened and how to fix it: "Bosta doesn't know this city. Pick a suggestion." Never "Invalid input".
- Checkbox 16px, switch 34×20 (ink when on), segmented control for 2–4 exclusive views.

## 4. Status and payment

| Badge | Meaning |
| --- | --- |
| `success` | Delivered, paid, matched, confirmed |
| `info` | In transit, shipped, in progress |
| `warning` | Pending, awaiting payment, overdue soon, medium risk |
| `danger` | Refused, failed, disputed, missing, high risk |
| neutral | New, draft, unknown |
| `ink` (no dot) | Strong neutral: Paid, Final |

- Badges always carry text; colour is never the only signal.
- Payment method is a `tag` with its icon: `cod`, `card`, `wallet`, `deposit`, `bnpl`, `bank-transfer`.
- Risk meter: 44px bar + score in mono; `<40` success, `40–69` warning, `≥70` danger. Always show the reasons on hover or in the panel.

## 5. Data display

- **Table:** sticky header (`surface-sunk`, 12/500, text-3), rows 44px, 13px text, numbers end-aligned and tabular, IDs in `mz-id` (Geist Mono 12.5), secondary line in `sub` (12, text-3). Hover `surface-hover`; selected `surface-selected` + 2px brand bar at inline-start. Bulk selection shows a bulk bar replacing the title row actions.
- **KPI tile:** label (12, text-2) → value (28/600 display, tabular, unit `small`) → delta (`up` success-text / `down` danger-text, with comparison period). Hero tile: `bg-primary text-on-primary`, value 36.
- **Key-value list** for the side panel: 120px label column.
- **Timeline:** newest first, first dot brand red, times in 12/text-3.
- **Charts:** data colours `viz-1…6` in fixed order (never cycled, never more than six), one axis, every value labelled or available on hover, chart text from `text-2/3`. Profit series in ink; red only for losses.

## 6. Feedback and states

- **Alert** (inline): info / warning / danger / success soft backgrounds, icon + bold lead + plain sentence.
- **Toast:** ink, bottom-end, 4s, one line, past tense ("24 orders shipped with Bosta"), optional Undo.
- **Empty state:** 24px icon, one-line title, one sentence, one action. Say what will appear and how to make it appear.
- **Loading:** skeletons shaped like the content; never spinners for whole pages.
- **Offline (ops app):** persistent banner "Offline · 12 scans waiting to sync"; nothing blocks scanning.
- **Confirmations:** destructive actions open a dialog naming the object and the consequence ("Cancel #EO-48213? Bosta will be asked to terminate the delivery.") with `danger-solid` confirm.

## 7. Floating layers

Menu (4px padding, 32px items), dialog (radius 12, max 480px), drawer (440px, inline-end), tooltip (ink, 12px), toast. These are the only elements with `shadow-overlay`. Enter with `mz-enter` (opacity + 4px translate, `ease-enter`, 200ms); exit faster (150ms, `ease-exit`). Respect `prefers-reduced-motion`.

## 8. Copy

- Write for the merchant: name things by what they recognize ("Cash with couriers", not "Settlement receivables").
- Buttons say exactly what happens: "Ship 24 orders", "Send deposit link", "Mark paid".
- Egyptian Arabic for merchant UI (أكد، اشحن، مستني الدفع), Gulf variants come from the dialect packs for customer-facing scripts.
- Numbers: Western digits by default in both languages; currency after the number in Arabic (`1,150 ج.م`), before in English (`EGP 1,150`).
- Never "Oops", never apologise in system messages, never blame the user.

## 9. RTL and Arabic

- `dir="rtl"` on `<html>`; layouts use logical properties only (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`). Lint rule: no `ml-/mr-/pl-/pr-/left-/right-/text-left/text-right` in components.
- IDs, phones, amounts, SKUs, tracking numbers, hex values: `mz-num` / `mz-id` / `<bdi>` (base.css isolates them LTR inside Arabic).
- Directional icons (`back`, `forward`, `send`, `chevron-start`, `chevron-end`, `returns`, `shipping`, `courier`, `logout`, `external`, `sidebar`) mirror automatically.
- Arabic text: never negative letter-spacing, no uppercase transforms, line height ×1.15 (handled by `.mz-text-*` under `:lang(ar)`), no tashkeel in UI strings.

## 10. Accessibility checklist

- Contrast: every text token pair is tested ≥ 4.5:1 in both themes (`npm test -w @mizan/design-system`).
- Focus: visible 2px ring in `--mz-focus` (ink in light, paper in dark), offset 2px, never removed.
- Targets: 36px desktop minimum, 44px touch (ops app, mobile web).
- Status never by colour alone; icons have labels when they carry meaning; tables have `<th scope>`.
- Keyboard: every action reachable; `⌘K` command palette; `Esc` closes layers and returns focus.
