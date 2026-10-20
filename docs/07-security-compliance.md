# 07 — Security, privacy and compliance

Mizan holds customer phones, addresses and payment data for many merchants at once. Trust is the product.

> ⚠️ This page is engineering guidance, not legal advice. Get a legal review per country before the risk network ships and before the first launch outside Egypt.

## 1. Threat model (top risks)

| Threat | Control |
| --- | --- |
| Tenant A reads tenant B's data | Postgres RLS (FORCE) on every table; app role without BYPASSRLS; tenant set per transaction; tests in `packages/db/test` |
| Stolen provider tokens (Shopify, Bosta, Meta) | Envelope encryption (Cloud KMS) in `secrets`; decrypted only in worker memory; rotated on disconnect; never logged |
| Forged webhooks | Shopify HMAC, Meta `X-Hub-Signature-256`, per-connection tokens for unsigned providers; **thin webhook, fat fetch** (re-read from API before acting) |
| Account takeover (owner) | Firebase Auth; 2FA required for owner and admin; session revocation; login alerts |
| Insider / support access | Platform admin access is just-in-time, audited (`audit_log`), and shown to the merchant |
| PII leakage via logs / analytics | Structured logger with PII redaction (phones, names, addresses, tokens); analytics events carry IDs only |
| Mass export | Export endpoints rate-limited, owner/finance only, audited |
| Supply chain | Lockfiles; Dependabot/Renovate; `npm audit` in CI; pinned base images |
| Card data exposure | Never collected: hosted payment pages and links only; PCI DSS scope stays with the gateway (merchant SAQ-A) |
| Fraudulent refunds | Role permissions, approval thresholds, refunds to original method by default, audit log, alerts on refund spikes |
| Wrong cash on a shipment | Engine `cashToCollect` rule; unknown payment methods never ship; chaos-tested |

## 2. Personal data handling

| Data | Where | Protection |
| --- | --- | --- |
| Customer phone | `customers.phone_e164`, `orders.ship_phone` | Application-level encryption (AES-256-GCM, tenant data key); `phone_hash` = HMAC-SHA256 with a tenant pepper for lookups |
| Name, address, location pin | `orders.ship_*`, `customers.name` | Same as phone; masked in lists (`010•••4821`); full view logged as `customer.pii_viewed` |
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
