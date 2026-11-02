# apps/admin — Mizan back office

For Mizan staff only (E17, A-7). Next.js (App Router) + Tailwind on `@mizan/design-system`, Arabic (default) and English with RTL, the same lint rules as `apps/web` (no physical directions, no literal UI strings).

It calls only `/v1/platform/*` on the API (no store header): the API decides who gets in (`PlatformGuard`: a second factor always, active staff, the route's role) and records every call in the staff trail. The screens only hide what a role cannot do.

| Page | API | Who |
| --- | --- | --- |
| Stores, store detail | A-2 `/platform/stores…` | everyone on the staff; suspend/reactivate super admin; plan super admin, finance |
| My support access | A-3 `/platform/access`, `/platform/stores/{id}/access` | super admin, support, engineer |
| System health | A-4 `/platform/health…` | super admin, engineer |
| Users | A-5 `/platform/users…` | super admin, support, engineer; disable sign-in super admin |
| Feature flags, announcements | A-6 | flags: super admin, engineer; announcements: super admin, support |
| Staff, staff trail | A-1 | super admin (trail: also engineer) |

## Sign-in

The same Mizan account as the dashboard: email and password, then the SMS code. Staff turn on two-step verification in the dashboard (Security) first; the back office refuses an account without it. The first super admin comes from `PLATFORM_BOOTSTRAP_EMAILS` on the API; others are added on the Staff page (they must have signed in to Mizan once).

## Commands

```
npm run dev -w @mizan/admin          # :3001 (NEXT_PUBLIC_API_URL, NEXT_PUBLIC_FIREBASE_* like apps/web; set ADMIN_URL on the API for CORS)
npm run gen:api -w @mizan/admin      # after an API change (test/api-schema.test.ts checks it)
npm run build:api && npm run build:e2e -w @mizan/admin && npm run e2e -w @mizan/admin   # Auth emulator (Java 21) + API + back office
```
