# Legal documents — drafts for counsel (E13-3)

> **Status: DRAFT, not legal advice, not published.** Written from what the code and infrastructure actually do (October 2026) so a lawyer qualified in Egypt (and later KSA/UAE) can review, correct and approve them. Nothing here goes live until approved. Every `[PLACEHOLDER]` is a fact only the owner can give; every `[CONFIRM]` is a legal point for counsel.

| Document | English | Arabic | Who it binds |
| --- | --- | --- | --- |
| Privacy policy | [privacy-policy.en.md](privacy-policy.en.md) | [privacy-policy.ar.md](privacy-policy.ar.md) | Mizan as **controller** of merchant-account data; explains our **processor** role for shoppers' data |
| Terms of service | [terms.en.md](terms.en.md) | [terms.ar.md](terms.ar.md) | Merchants (the store's account holder and their team) |
| Data processing agreement | [dpa.en.md](dpa.en.md) | [dpa.ar.md](dpa.ar.md) | Merchant (controller) ↔ Mizan (processor), Egypt Law 151/2020 and KSA PDPL |
| Cookie and storage notice | Section 9 of the privacy policy, and the inventory below | same | Everyone who uses the web app |

The Arabic versions are in Modern Standard Arabic (legal register), not the Egyptian Arabic used in the app's interface. Which language prevails is a `[CONFIRM]` (draft: Arabic for Egyptian merchants, as Egyptian courts work in Arabic).

## How they reach the app (L1-3)

**These files are the source of truth.** The web app shows copies of them at `/{ar,en}/legal/terms`, `/privacy` and `/dpa` (`apps/web/content/legal/`, rendered as plain Markdown, no HTML); a web test fails when a copy differs from its file here, so change the text here and copy it over (`cp docs/legal/*.{ar,en}.md apps/web/content/legal/`).

- **Versions and status** live in `packages/shared/src/legal.ts`: `LEGAL_VERSIONS` (bump a document's version whenever its text changes) and `LEGAL_STATUS`, `"draft"` until counsel approves and the placeholders are filled. While it is a draft, the pages carry a "draft under legal review, not in force" banner and nobody is asked to accept.
- **Acceptance:** the owner ticks "I agree to the Terms of service and the Data processing agreement" when creating a store; the API records each document's version, the time, who and in which language (`legal_acceptances`, audited `tenant.legal_accepted`). Settings → Store shows what was accepted.
- **Going live** is one change in `legal.ts`: set the approved versions (`LEGAL_VERSIONS` to `"1.0"`; drafts are `0.x`) **and** `LEGAL_STATUS = "published"`. The version bump is required, not optional: owners who ticked the box at store creation while the texts were drafts accepted `0.1`, and that must not count as accepting the approved text (a shared test fails on `"published"` with a `0.x` version). From then on an owner whose store has not accepted the current versions sees a full-page "Accept and continue" in the dashboard before using the store, and the rest of the team sees a banner. Bumping a version later asks every owner again. The API does not refuse requests from a store that has not accepted yet (follow-up in `docs/10-backlog.md`, L1-3).

## What the owner must fill in `[PLACEHOLDER]`

1. The contracting company: legal name, commercial registration number, tax ID, registered address (Brandita entity or a dedicated Mizan company).
2. Contact addresses: `privacy@…`, `legal@…`, `support@…`, and the data protection officer (DPO) if one is appointed.
3. Prices and billing: currency, billing cycle, VAT, refunds of fees, what happens on non-payment (grace period). Plans today are proposals (`docs/01-business-model.md`).
4. Effective date and version number of each document.

## Points for counsel `[CONFIRM]`

1. **Egypt Law 151/2020:** whether Mizan must obtain a licence or permit from the Personal Data Protection Center as a processor, and appoint a DPO; status of the executive regulations; cross-border transfer rules (hosting is in Microsoft Azure UAE North, Dubai, outside Egypt).
2. **KSA PDPL:** whether Saudi stores must be hosted in the Kingdom (draft: an in-Kingdom region when required `[CONFIRM]`), registration with SDAIA, transfer conditions.
3. **Retention:** shoppers' personal data kept while the merchant is active + 90 days after the account closes, then deleted (financial records kept without personal data). Is 90 days right, and what do tax and e-commerce rules require the *merchant* to keep?
4. **Breach notification:** the law's deadline to the authority (draft says we tell the merchant without undue delay and within 24 hours of confirming a breach, so the merchant can meet 72 hours).
5. **Liability cap** (draft: fees paid in the previous 12 months), governing law and courts (draft: Egypt, Cairo courts, or arbitration at CRCICA), consumer-law carve-outs.
6. **AI-written offers** (Anthropic): only product data and prices are sent, never shoppers' data. Confirm no further disclosure is needed, and set the Anthropic organisation's zero-retention option before production.
7. **WhatsApp:** the merchant is responsible for the shopper's consent to be messaged; Mizan records opt-in and opt-out. Confirm wording against Egypt's consumer protection law and telecom rules.
8. **Payment data:** Mizan never receives card numbers (hosted gateway pages only). Confirm no PCI-DSS obligations beyond SAQ A for the merchant.

## Sub-processors (as built)

| Sub-processor | What for | Data | Where |
| --- | --- | --- | --- |
| Microsoft Azure (Microsoft Corporation / `[CONFIRM contracting entity]`): Container Apps, Database for PostgreSQL, Key Vault, Monitor and Log Analytics | Hosting, database, key management, logs, monitoring | All service data; logs carry no names, phones or addresses | UAE North (Dubai, UAE); for Saudi stores, an in-Kingdom region when required `[CONFIRM]` |
| Google Firebase Authentication | Sign-in for merchants' teams (email, phone one-time codes, second step) | Team members' email, phone, sign-in events | Google global infrastructure `[CONFIRM region]` |
| Google Firebase Cloud Messaging | Push notifications to the ops app | Device tokens, notification text (no shopper data) | Global |
| Meta Platforms (WhatsApp Cloud API) | Order confirmation messages, only when the merchant connects their WhatsApp Business number | Shopper's phone, first name, order number, items, amount | Meta's infrastructure, global |
| Anthropic (Claude API) | Writing an upsell offer, only when the merchant turns it on | Store name, product titles, prices, quantities. **No shopper data** | USA `[CONFIRM]` |

**The merchant's own providers are not our sub-processors**: their store (Shopify, WooCommerce), couriers (Bosta, J&T…), payment gateways (Paymob…), and their WhatsApp number belong to the merchant's own contracts. Mizan connects to them on the merchant's instruction. `[CONFIRM]` this characterisation.

## Cookies and browser storage (as built)

No analytics, advertising or third-party tracking cookies. Everything is needed for the service or remembers a choice the user made, so under the draft notice no consent banner is needed: a notice is enough `[CONFIRM]`.

| Name | Kind | Purpose | Lifetime |
| --- | --- | --- | --- |
| `mizan-theme` | Cookie (first party) | Light, dark or system theme | 1 year |
| `mizan-locale` | Cookie (first party) | Arabic or English | 1 year |
| Firebase Auth session | IndexedDB (first party, Firebase SDK) | Keeps the user signed in | Until sign-out |
| `mizan-store:<user id>` | localStorage | The store last opened | Until cleared |
| `mizan-announcement:<id>` | localStorage | Don't show a dismissed announcement again | Until cleared |
| `mizan-plan-banner:<store>:<level>` | sessionStorage | Hide the plan banner for this tab | Tab session |

When the public marketing site is built, any analytics there must be added to this table and, if not strictly necessary, behind consent.

## Before publishing (checklist)

- [ ] Placeholders filled; counsel's review applied to both languages; the two versions checked against each other.
- [x] Pages at `/ar/legal/…` and `/en/legal/…` (L1-3); still to do: the Shopify App Store listing's privacy policy URL.
- [x] Sign-up asks the owner to accept the terms and the DPA; version and time recorded per store (L1-3).
- [ ] `LEGAL_STATUS` set to `"published"` in `packages/shared/src/legal.ts` (and the versions set to the approved ones).
- [ ] A change log; merchants told 30 days before material changes.
