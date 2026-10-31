# Mizan — Data processing agreement

> **DRAFT for legal review. Not published.** Version `[PLACEHOLDER 0.1]`. Arabic version: `dpa.ar.md`; `[CONFIRM]` which prevails. Drafted for Egypt's Personal Data Protection Law No. 151 of 2020 and, for Saudi merchants, the KSA Personal Data Protection Law; `[CONFIRM]` the terms and articles to cite once the executive regulations are checked.

This agreement forms part of the Mizan terms of service between the merchant (**controller**) and `[PLACEHOLDER: legal entity]` (**Mizan, processor**).

## 1. Subject and duration

Mizan processes personal data of the merchant's shoppers and of others in the merchant's records (for example suppliers' contacts) only to provide the service, for as long as the terms are in force and until the data is deleted under section 10. Details are in Annex 1.

## 2. Processing on instructions

Mizan processes the data only on the merchant's documented instructions: these terms, the settings the merchant chooses in Mizan (connected services, automations, confirmation channels, AI offers on or off), and written requests. If an instruction appears to break the law, Mizan tells the merchant and may decline it. Mizan does not sell the data, use it for its own purposes, or use it to train AI models.

## 3. The merchant's responsibilities

The merchant has a lawful basis for the processing, gives shoppers a privacy notice that mentions processors like Mizan, collects the consents required (including to receive WhatsApp messages), and gives only instructions that comply with the law.

## 4. Confidentiality

Everyone at Mizan who can access the data is bound by confidentiality. Staff access is limited to what a task needs, for a limited time, with a recorded reason, shown to the merchant in the app while open, and logged.

## 5. Security

Mizan applies the measures in Annex 2 and keeps them at least as protective during the agreement.

## 6. Sub-processors

The merchant authorises the sub-processors in Annex 3. Mizan tells the merchant `[PLACEHOLDER: 30 days]` before adding or replacing one; the merchant may object on reasonable data protection grounds, and if the parties cannot agree the merchant may end the affected service without penalty. Mizan imposes data protection obligations on each sub-processor no less protective than these and remains responsible for them. Services the merchant connects under its own contracts (its store platform, couriers, payment gateways, its WhatsApp Business account) are not Mizan's sub-processors `[CONFIRM]`.

## 7. Transfers

Data is hosted in Microsoft Azure's UAE North region (Dubai, UAE); for Saudi merchants, in an in-Kingdom region when required `[CONFIRM]`. Where a sub-processor processes data in another country, Mizan relies on `[CONFIRM: licence/permit from the Personal Data Protection Center, adequacy, or contractual safeguards; SDAIA transfer conditions for KSA]`.

## 8. Data subjects' requests

Mizan helps the merchant answer requests to access, correct, delete or restrict data. Built-in tools: deletion of a shopper's personal data on request (Shopify `customers/redact`, `shop/redact`), compilation of a shopper's data for an access request (Shopify `customers/data_request`, exported by the owner or an admin), and records of opt-in and opt-out to messages. Mizan forwards to the merchant any request it receives directly, without answering it itself unless instructed.

## 9. Personal data breaches

Mizan tells the merchant without undue delay, and within `[CONFIRM: 24 hours]` of confirming a breach affecting the merchant's data, with what is known: what happened, the data and people likely affected, likely consequences, and the measures taken. Mizan updates the merchant as it learns more and helps it notify the authority and the people affected within the legal deadline `[CONFIRM: 72 hours under Law 151/2020]`.

## 10. Deletion or return at the end

At the end of the service the merchant can export its data for `[PLACEHOLDER: 30 days]`. Mizan then deletes the shoppers' personal data within 90 days (deleting the store's encryption key also makes any remaining copies unreadable), and backups are overwritten within 14 days after that. Financial records without personal data are kept only as the law requires. Mizan confirms deletion in writing on request.

## 11. Audits and information

Mizan makes available the information needed to show compliance: this agreement, its security description, sub-processor list and, when obtained, independent reports `[PLACEHOLDER: e.g. penetration test summary, certifications]`. The merchant may audit once a year, with 30 days' notice, at its cost, under confidentiality, in a way that does not expose other merchants' data; or rely on those reports.

## 12. Assistance

Mizan assists the merchant, taking into account the nature of the processing, with data protection impact assessments and consultations with the authority.

## 13. Liability and precedence

Liability under this agreement follows the terms of service `[CONFIRM: whether data protection breaches are capped]`. If this agreement and the terms conflict on personal data, this agreement prevails.

---

## Annex 1 — Details of the processing

| | |
| --- | --- |
| **Data subjects** | The merchant's shoppers (customers and recipients); the merchant's suppliers' contacts; the merchant's team members (for activity records) |
| **Personal data** | Name; phone; email (if provided by the store); delivery address and map location; order contents and amounts; payment method, status and gateway reference (never card numbers); delivery, return and refusal events; confirmation results and WhatsApp message status and button taps (not message text); notes the team writes on orders and tickets; a keyed hash of the phone (for matching without decrypting) |
| **Special categories** | None intended. The merchant should not put health, religious or other sensitive data in notes `[CONFIRM wording]` |
| **Operations** | Receiving orders from the merchant's store; storing; encrypting; showing to the merchant's team by role; sending order confirmation messages; booking shipments and tracking them with the merchant's couriers; recording payments, refunds and disputes; computing profit; reports and exports; deleting on request |
| **Purpose** | Running the merchant's orders, payments, stock, shipping and customer service |
| **Duration** | The term of the agreement plus the deletion period in section 10 |

## Annex 2 — Security measures (as built)

1. **Isolation:** every store's data carries its own identifier and the database enforces row-level security per store on every query.
2. **Encryption:** TLS in transit; database and backups encrypted at rest by the cloud provider; shoppers' name, phone and street address additionally encrypted per store (AES-256-GCM), with keys wrapped by Azure Key Vault; provider tokens and API keys encrypted the same way and never logged.
3. **Minimisation in use:** lists and searches never decrypt names or phones (a short label and last four digits; phone search by keyed hash); full contact details only on an explicit, rate-limited, recorded request by permitted roles; logs and analytics carry identifiers, not personal data.
4. **Access control:** sign-in through Firebase Authentication; two-step sign-in required for owners and admins; roles (owner, admin, operations manager, agent, warehouse, finance) with least privilege; disabled users refused at once.
5. **Accountability:** append-only audit log of changes and of every access to full personal data, visible to the store's owner and admins; Mizan staff access just-in-time with a reason and expiry, shown to the merchant.
6. **Resilience:** daily backups (14 kept) and point-in-time recovery (7 days); a tested restore procedure; monitoring and alerts on errors, latency, database health and uptime.
7. **Secure development:** typed code, automated tests on every change, secret scanning, dependency updates, verified webhooks (HMAC signatures), idempotent writes; penetration test before general availability `[PLACEHOLDER: date]`.
8. **Payments:** no card data enters Mizan; payment pages and links are the gateway's own.

## Annex 3 — Authorised sub-processors

| Sub-processor | Service | Data | Location |
| --- | --- | --- | --- |
| Microsoft Azure (Microsoft Corporation / `[CONFIRM contracting entity]`) | Hosting, database, key management, logs, monitoring | All service data | UAE North (Dubai, UAE); an in-Kingdom region for Saudi merchants when required `[CONFIRM]` |
| Google Firebase (Google LLC) | Authentication of the merchant's team; push notifications to the staff app | Team members' email and phone; device tokens | `[CONFIRM]` |
| Meta Platforms (WhatsApp Cloud API) | Sending confirmation messages from the merchant's WhatsApp number, when connected | Shopper's phone, first name, order number, items and amount | `[CONFIRM]` |
| Anthropic | Writing upsell offer text, when the merchant enables it | Store name, product titles, prices and quantities. No shoppers' personal data | USA `[CONFIRM]` |
