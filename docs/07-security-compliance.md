# 07 — Security, privacy and compliance

Mizan holds customer phones, addresses and payment data for many merchants at once. Trust is the product.

> ⚠️ This page is engineering guidance, not legal advice. Get a legal review per country before the risk network ships and before the first launch outside Egypt.

## 1. Threat model (top risks)

| Threat | Control |
| --- | --- |
| Tenant A reads tenant B's data | Postgres RLS (FORCE) on every table; app role without BYPASSRLS; tenant set per transaction; tests in `packages/db/test` |
| Stolen provider tokens (Shopify, Bosta, Meta) | Envelope encryption (Cloud KMS) in `secrets`; decrypted only in worker memory; rotated on disconnect; never logged. ✅ `SecretsService` (E1-10): per-secret AES-256-GCM data key, AAD binds ciphertext to tenant + row, data key wrapped by Cloud KMS (REST, metadata-server credentials); `SecretValue` prints `[secret]`; create/rotate/delete audited; `rewrapStale()` after KMS key rotation |
| Store connected to the wrong account (OAuth CSRF / login CSRF) | ✅ Shopify install (E3-1): `state` is HMAC-signed (key derived from the client secret), expires in 10 min and names the shop; an install started inside Mizan also names the user and store, and only they can claim it. The callback never creates a connection: it seals the token as a pending install (`shopify_installs`, envelope-encrypted, AAD = install id, 1 h) and hands the browser a one-time claim token (only its SHA-256 is stored); a signed-in owner/admin claims it. App Store installs (OAuth before any Mizan sign-in, as Shopify requires) are claimable by whoever completes sign-in in that browser. Codes and tokens go only to `*.myshopify.com` (no SSRF via `shop`); one Shopify store belongs to one account; redirects send `Referrer-Policy: no-referrer` |
| Forged webhooks | Shopify HMAC, Meta `X-Hub-Signature-256`, per-connection tokens for unsigned providers; **thin webhook, fat fetch** (re-read from API before acting) |
| Account takeover (owner) | Firebase Auth; 2FA required for owner and admin (✅ enforced by `AuthGuard` from the token's `sign_in_second_factor`, `AUTH_REQUIRE_MFA`, on by default in production). The dashboard (E4-2) signs owners and admins in with email + password, then an SMS code (Firebase phone second factor); an owner without it is sent to turn it on (verify email → enrol phone → sign in again with the code). Agents and warehouse staff may sign in with phone + SMS code alone. Firebase errors are shown in our words, never Firebase's text; the post-sign-in redirect accepts in-app paths only; session revocation (ID tokens verified locally, 1 h lifetime; disabling a membership takes effect on the next request; refresh-token revocation check is a follow-up); login alerts |
| Insider / support access | Platform admin access is just-in-time, audited (`audit_log`), and shown to the merchant. ✅ `audit_log` (E1-9): tenant RLS, append-only for the app role (no UPDATE/DELETE), written in the same transaction as the change; before/after pass the PII redactor |
| PII leakage via logs / analytics | Structured logger with PII redaction (phones, names, addresses, tokens); analytics events carry IDs only |
| Mass export | Export endpoints rate-limited, owner/finance only, audited |
| Supply chain | Lockfiles; Dependabot/Renovate; `npm audit` in CI; pinned base images |
| Card data exposure | Never collected: hosted payment pages and links only; PCI DSS scope stays with the gateway (merchant SAQ-A) |
| Fraudulent refunds | Role permissions, approval thresholds, refunds to original method by default, audit log, alerts on refund spikes |
| Wrong cash on a shipment | Engine `cashToCollect` rule; unknown payment methods never ship; chaos-tested |

**HTTP posture (✅ H-2):** security headers on every response (CSP `default-src 'none'`, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, HSTS with preload in production); CORS only for the web and admin apps, never with credentials (bearer tokens only); request bodies capped (`MAX_BODY_BYTES`); malformed or oversized bodies answer problem+json.

## 2. Personal data handling

| Data | Where | Protection |
| --- | --- | --- |
| Customer phone | `customers.phone_e164`, `orders.ship_phone` | Application-level encryption (AES-256-GCM, tenant data key); `phone_hash` = HMAC-SHA256 with a tenant pepper for lookups. ✅ `apps/api/src/platform/pii/pii-cipher.ts`: one random key per tenant (KMS-wrapped in `secrets`), HKDF → encryption key + pepper; deleting the tenant key crypto-shreds all its PII |
| Name, address, location pin | `orders.ship_*`, `customers.name` | Same as phone; masked in lists; full view logged as `customer.pii_viewed`. ✅ E5-1: the order list never decrypts names or phones: it reads a separate encrypted label (`Mona A.`) and the phone's last four digits; search covers order numbers and phones (by hash) only, never names |
| Email | `customers.email`, `users.email` | Encrypted at rest (DB-level) |
| Payment data | Never stored: no card numbers, CVV or bank credentials | PSP-hosted payment pages only; Mizan stores amounts, method, status and the gateway reference |
| Provider credentials | `secrets` | Envelope encryption, KMS |

**Retention:** order PII kept while the merchant is active + 90 days after cancellation, then deleted or anonymized (keep financial aggregates). Configurable per tenant for legal holds. `[CONFIRM with counsel]`

## 3. Regulations

| Law / rule | Applies | What we do |
| --- | --- | --- |
| **Egypt — Personal Data Protection Law 151/2020** | All Egyptian merchants and customers | Lawful basis via merchant (controller) → Mizan (processor) DPA; data subject rights; breach notification process; check licensing/registration duties with the data protection authority `[CONFIRM]` |
| **KSA — PDPL** | Saudi merchants | DPA; data residency assessment (host in KSA when required); cross-border transfer rules `[CONFIRM]` |
| UAE PDPL and others | Before launch there | Map before launch |
| **Shopify** protected customer data | Shopify merchants | Level 2 approval; minimum fields; encryption; access logs; incident policy; **mandatory compliance webhooks** |
| **WhatsApp Business** policy | All confirmation and campaigns | Opt-in recorded (`customers.whatsapp_opt_in`, `opt_in_at`, source); approved templates; opt-out on every marketing message |
| **ZATCA** e-invoicing | KSA merchants (V2) | Phase 2 integration per merchant; private keys in KMS |
| Egypt ETA e-receipt | Obligated merchants | Decision-based; per-merchant onboarding |

### Shopify compliance webhooks (required for the App Store)

| Topic | Action | Deadline |
| --- | --- | --- |
| `customers/data_request` | Create `privacy_requests` row; compile the customer's data; send to merchant | Respond within 30 days |
| `customers/redact` | Delete or anonymize the customer's PII (orders keep financial fields) | Within 30 days |
| `shop/redact` (48 h after uninstall) | Delete the shop's data | Within 30 days |

All three verified with the Shopify HMAC; acknowledged with 200 immediately; processed by a job; completion logged.

✅ **Built (E3-3):** `POST /webhooks/shopify/gdpr` verifies the HMAC, parses through the engine (`parseComplianceWebhook`, `Resolver`), and records one `privacy_requests` row per store that ever held the shop (deduplicated by Shopify's event id, due in 30 days). The row keeps ids and a phone **hash** only, never the email or phone Shopify sent. The `privacy.shopify` consumer then, in the store's transaction:

- **customers/redact:** personal data (`ship_name/phone/line1/line2`, coordinates) of the named orders and of every order from this shop of the customer matched by phone hash is cleared; the order keeps totals, payments, statuses and city/province/country; `orders.pii_redacted_at` stops the projector from writing it back. A customer known **only** through this shop loses name, phone, email, phone hash and WhatsApp opt-in; one also known from another channel keeps them (that data came from the store's other channel). Engine records (`mz_records`) of those orders are scrubbed the same way.
- **shop/redact:** the same for every order of the shop and every Shopify-only customer. Financial facts stay with the merchant's account: they are the merchant's own business records; deleting the whole account is a separate request. `[CONFIRM with counsel]`
- **customers/data_request:** the customer's data from this shop is compiled, encrypted with the store's PII key, and listed for owners/admins at `GET /v1/privacy-requests`; every download (`/export`) is audited. Notifying the merchant comes with M13 notifications.
- Matching by email is not possible (emails are encrypted with random IVs): orders named by Shopify plus the phone hash cover the customer. Every step writes `privacy.request_received` / `privacy.request_completed` to the audit log and emits `privacy.requested` / `privacy.completed`.

## 4. Risk network (M11) privacy design

- Shared data = salted phone hash + outcome (delivered / refused / fake) + date + region. **No tenant id, no name, no address, no order value.**
- Hash salt is global per region, stored in KMS, rotated yearly (scores recomputed).
- Merchants opt in; source stores are never revealed; minimum k-anonymity (e.g. only show a score after outcomes from ≥ 3 stores).
- Data kept in its region; limited retention (e.g. 12 months) `[CONFIRM]`.
- Separate schema and service; no joins to tenant tables.
- Legal review per country before launch.

## 5. Application security checklist (CI + review)

- [ ] Input validation with zod on every endpoint; output DTOs never return raw rows.
- [ ] Authorization check per route by role and per resource by tenant (RLS is the second line, not the first).
- [ ] CSRF: API uses bearer tokens, no cookies for auth; web app uses `SameSite=Lax` session cookie only for Next.js server actions if used.
- [ ] Security headers on web (CSP, HSTS, frame-ancestors none).
- [ ] Rate limits on auth, OTP, exports, webhooks.
- [ ] Secrets only from Secret Manager / env; `.env` gitignored; secret scanning in CI (gitleaks).
- [ ] Dependency audit in CI.
- [ ] Penetration test before public launch.

## 6. Operations

- Daily backups + point-in-time recovery; restore drill monthly.
- 99.5% uptime target at launch; status page.
- Incident response: severity levels, on-call, merchant notification template (AR/EN), post-mortem within 5 working days.
- Access reviews quarterly; offboarding checklist.
