# apps/web — Mizan dashboard

Next.js 16 (App Router) + Tailwind CSS 4, Arabic and English, right-to-left first-class.
Look and feel: `@mizan/design-system` (`packages/design-system`: tokens, fonts, icons, wordmark, component recipes). Layout reference: `design/prototype.html`. Rules: `docs/08-design-system.md`.

```
npm run dev -w @mizan/web      # http://localhost:3000 → /ar (needs `npm run build -w @mizan/shared` once; sign-in config: .env.example)
npm run lint -w @mizan/web     # Next rules + Mizan bilingual rules
npm test -w @mizan/web         # unit: lint rule, AR/EN message parity, formatting, design classes, redirect guard
npm run build:api && npm run build:e2e -w @mizan/web && npm run e2e -w @mizan/web
                               # Playwright: Firebase Auth emulator (Java 21) + real API (PGlite) + this build
```

## Sign-in and the store gate (E4-2)

```
/sign-in → signed in → (app) gate → GET /v1/me → no store → /welcome (accept an invitation · create a store)
                                  → GET /v1/tenant (X-Tenant-Id) → mfa_required → /security/two-step
                                                                 → ok → the page
```

- Owners and admins: email + password, then an SMS code (Firebase phone second factor). Turning it on needs a verified email; after enrolling, the person signs in again so the token carries the second factor.
- Agents and warehouse staff: phone number + SMS code (Egyptian numbers typed locally; `+966…`, `+971…` with the country code).
- `src/lib/session.tsx`: Firebase user, `/me` and the store check as queries, the chosen store (localStorage `mizan-store:<uid>`), `useApi()` (the typed client for the current store).

## Calling the API (E4-4)

```ts
const api = useApi();                                                    // person + language + store
const team = useQuery({ queryKey: ["team", store.tenantId], queryFn: () => ok(api.GET("/v1/members")) });
const [key] = useState(() => crypto.randomUUID());                       // stable across retries
const invite = useMutation({ mutationFn: (body: Schemas["Invite"]) => ok(api.POST("/v1/members/invite", { body, headers: idempotency(key) })) });
```

- Types come from `apps/api/openapi.json` (`npm run gen:api`, file `src/lib/api/schema.d.ts`, never edited by hand; a test fails when it is stale).
- Errors: `ApiError` with the problem `code` (switch on it) and `title` (already in the user's language). Failed mutations toast the title; queries show errors in place; `meta: { toast: false }` when the screen shows the error itself.
- Retries: network, 5xx, 429, `token_expired` only (twice, with backoff). POSTs are safe to retry because of the idempotency key.
- Sign-out goes to sign-in; an ended session goes to sign-in and back (`?next=`, in-app paths only).

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
| `src/app/[locale]/(app)/` | Store pages behind `StoreGate`, inside `Shell` |
| `src/app/[locale]/{sign-in,welcome,security/two-step}/` | Pages outside a store (`AuthFrame`) |
| `src/components/onboarding/` | Setup wizard (E4-5): steps, `useOnboarding` (polls while the import, a key check or the first order is under way), setup card on home, Shopify callback (`/integrations/shopify/connect`, claims the install once) |
| `src/components/ui/` | UI kit (E4-3) over the design system's `mz-*` classes: buttons, fields, combobox, choice controls, tabs, badges, KPI tiles, data table, dialog/drawer/menu/tooltip/toast, command palette, money/phone/date. Gallery: `/ar/ui`, `/en/ui` (sample data, no sign-in) |
| `src/components/` | `Shell` (ink rail with wordmark, store switcher and icons; header with user menu), `AuthFrame`, `auth/*` (sign-in, two-step, welcome, gates), `ui/*` (Button, Field, Alert), `Bdi`, `Segmented`, language and theme switches |
| `e2e/` | `env.mjs` (the e2e stack), `stack.ts` (emulator codes and links, seeded people and stores), `auth.spec.ts`, `smoke.spec.ts`, `firebase.json` (emulator) |
| `eslint-rules/no-physical-direction.js` | Blocks `ml-*`, `pr-*`, `left-*`, `text-right`, `border-l`, `rounded-tr` … with the logical fix in the message |

## Rules (lint-enforced)

- Logical directions only: `ms-/me-/ps-/pe-/start-/end-/text-start/border-s/rounded-s…` (`mizan/no-physical-direction`).
- No literal UI text in JSX: strings come from `messages/*.json` (`react/jsx-no-literals`); both files keep the same keys, arguments and tags (unit test).
- Order ids, phones, SKUs, tracking numbers: `<Bdi code>`; amounts: `formatMoney` inside `<Bdi>`.
- Only design system tokens for colour, type, radius, font and shadow (unit test `design-classes`); never hex values.
- Icons come from `@mizan/design-system/icons/react`; directional ones mirror in RTL by themselves.

The Cloud Run image builds with `NEXT_OUTPUT=standalone` (self-contained server); `next start` uses the default output.
