# Mizan — Privacy policy

> **DRAFT for legal review. Not published.** Version `[PLACEHOLDER 0.1]`, effective `[PLACEHOLDER date]`. The Arabic version is in `privacy-policy.ar.md`; `[CONFIRM]` which prevails.

## 1. Who we are

Mizan is a commerce operating system for online stores, provided by `[PLACEHOLDER: legal entity name]`, commercial registration `[PLACEHOLDER]`, registered at `[PLACEHOLDER: address]` ("Mizan", "we"). Contact for privacy matters: `[PLACEHOLDER: privacy@…]`. Data protection officer: `[PLACEHOLDER or "not appointed"]`.

## 2. Two roles, two kinds of data

- **Merchants and their teams** (the people who sign in to Mizan): for their account data, **Mizan is the controller**. This policy covers that data in full.
- **Shoppers** (the merchant's customers): their orders, names, phones and addresses reach Mizan from the merchant's store, and Mizan handles them **on the merchant's behalf, as a processor**, under the data processing agreement with the merchant. The merchant is the controller and their own privacy notice applies. If you are a shopper, contact the store you bought from; we will help them answer you (section 8).

## 3. What we collect about merchants and their teams

| Data | Why | Legal basis `[CONFIRM terms under Law 151/2020]` |
| --- | --- | --- |
| Name, email, phone number, role in the store | Create and secure the account; sign-in with a one-time code and a second step for owners and admins | Contract |
| Store details (name, country, currency, time zone), connected services | Run the service you subscribed to | Contract |
| Activity records: sign-ins, what was changed, who viewed a shopper's full contact details | Security, accountability, resolving disputes | Legitimate interest; legal obligation |
| Billing details (plan, invoices; payment through `[PLACEHOLDER: billing provider]`) | Charge for the service | Contract; legal obligation (tax) |
| Support conversations | Help you | Contract |
| Technical data (IP address, browser, error reports) | Keep the service working and safe | Legitimate interest |

We do **not** use advertising trackers or sell personal data. We do not use your data, or your shoppers' data, to train AI models.

## 4. How shoppers' data is handled (summary of the processor role)

- **What:** name, phone, delivery address and location pin, order contents, amounts, payment method and status, delivery and return events, confirmation messages' status (sent, read, button tapped; message bodies are not stored).
- **How it is protected:** phone, name and street address are encrypted in the database with a key unique to each store (AES-256-GCM, keys wrapped by Google Cloud KMS). Lists show a short label and the phone's last four digits only. Seeing a full contact is limited by role and is recorded each time.
- **Payment cards:** Mizan never receives card numbers or CVV. Payments happen on the gateway's own pages.
- **Messages:** if the merchant connects WhatsApp, Mizan sends order confirmation messages from the merchant's number and records the shopper's consent or "stop" request.
- **AI:** if the merchant turns on AI-written offers, only product names, prices and quantities are sent to the AI provider, never a shopper's name, phone or address.
- **Deletion:** when the store asks (including through Shopify's privacy requests), the shopper's personal data is deleted or made anonymous within 30 days; financial records stay without personal data.

## 5. Who we share data with

We share data only with service providers that help us run Mizan (sub-processors), under contracts that protect it:

| Provider | Purpose | Location |
| --- | --- | --- |
| Google Cloud | Hosting, database, encryption keys, logs | Doha, Qatar; Dammam, KSA for Saudi stores where required |
| Google Firebase | Sign-in; push notifications to the staff app | `[CONFIRM]` |
| Meta (WhatsApp Cloud API) | Confirmation messages, only if the merchant connects WhatsApp | Global |
| Anthropic | Writing offers, only if enabled; no shopper data | USA `[CONFIRM]` |

Services the merchant connects (their store platform, couriers, payment gateways) receive data on the merchant's instruction under the merchant's own agreements with them. We may also disclose data when the law requires it, after checking the request is valid and, where allowed, telling the merchant.

## 6. Where data is stored and transfers

Data is hosted in Google Cloud's Middle East regions (Doha; Dammam for Saudi stores where required). Some providers above may process data in other countries. Where the law restricts transfers, we rely on `[CONFIRM: permit / adequacy / contractual safeguards under Law 151/2020 and PDPL]`.

## 7. How long we keep data

| Data | Kept |
| --- | --- |
| Merchant account and team data | While the account is open, then `[PLACEHOLDER: 90 days]`, except what tax law requires us to keep |
| Shoppers' personal data | While the merchant's account is active; deleted within 90 days after it closes, or sooner when the merchant or Shopify asks `[CONFIRM]` |
| Financial records (amounts, dates, order numbers), without personal data | As long as the merchant's records require `[CONFIRM]` |
| Activity and security logs | `[PLACEHOLDER: 12 months]` |
| Database backups | Overwritten within 14 days (recovery points: 7 days) |
| Technical queues and webhook records | Deleted automatically after 7 to 30 days |

## 8. Your rights

Under Egypt's Personal Data Protection Law (151/2020), and the Saudi PDPL where it applies, you may ask to know what data we hold about you, get a copy, correct it, delete it, object to or restrict its use, and withdraw consent where we rely on it. Write to `[PLACEHOLDER: privacy@…]`; we answer within `[CONFIRM: 30 days]`. You may also complain to the Personal Data Protection Center in Egypt `[CONFIRM name and contact]` or the competent authority in your country.

**Shoppers:** your request goes to the store (the controller). If you write to us, we will pass it to the store and support them in answering.

## 9. Cookies and similar storage

Mizan's app uses only what it needs to work or to remember a choice you made: the theme and language you picked (cookies, 1 year), keeping you signed in (stored by the sign-in service in your browser), and which store you last opened or which notice you dismissed (stored in your browser). There are no analytics, advertising or third-party tracking cookies. You can clear them in your browser; you will then need to sign in again and choose your settings again. The full list is kept at `[PLACEHOLDER: URL of the cookie table]`.

## 10. Security

Encryption in transit (TLS) and at rest, encryption of shoppers' contact details per store, two-step sign-in for owners and admins, role-based access, records of who accessed what, isolation of each store's data at the database level, and access by Mizan staff only when the merchant's request needs it, for a limited time, recorded and shown to the merchant. No system is perfectly secure; if a breach affects your data, we will tell you and the authorities as the law requires.

## 11. Children

Mizan is a business service and is not meant for anyone under 18 `[CONFIRM age]`.

## 12. Changes

We will tell account owners by email and in the app at least 30 days before a material change takes effect. The version and date are at the top.

## 13. Contact

`[PLACEHOLDER: legal entity, address, privacy@…]`
