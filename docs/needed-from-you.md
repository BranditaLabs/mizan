# What Mizan needs from you · المطلوب منك

Everything the code cannot do by itself: accounts, approvals, keys and decisions. The items are in priority order. Each one says **what to do**, **where to do it**, and **what to give back** (and where to put it).

> ⚠️ **Never paste a secret (token, API key, app secret) in chat, an issue or a commit.** Each secret has its place below: Google Secret Manager, or the form inside Mizan where a merchant pastes their own key. Mizan stores them encrypted and never shows them again.

Legend: 🔴 blocks the pilot · 🟡 needed before launch · 🟢 later phase

---

## 0. Company paperwork (needed by almost every platform) 🔴

Meta, Shopify, payment gateways and couriers all ask for these before granting access:

- [ ] Commercial registration and tax card (Egypt) for the company that owns Mizan / Brandita.
- [ ] A public website on Mizan's domain with a **privacy policy** and **terms of service** (Arabic and English).
- [ ] A short **data protection document**:
  - encryption (we have it: KMS + per-store keys);
  - retention;
  - who can see customer data (access is logged);
  - incident response.

  I can draft it from `docs/07-security-compliance.md`; you review it with a lawyer.
- [ ] One named technical owner (email + phone) for each platform account below.
- [ ] Ask a lawyer whether Mizan must register with or get a licence from Egypt's Personal Data Protection Centre under Law 151/2020. We process customer phones and addresses for merchants.

---

## 1. WhatsApp (Meta) — for confirmation inside the chat 🔴

This is what E6-10 needs to work for real. Until it's done, confirmation goes straight to the team-call list.

### 1.1 Once, for Mizan (the platform)

| # | Do | Where | Give back |
|---|----|-------|-----------|
| 1 | Create / verify the **Meta Business portfolio** (Brandita). Verification needs the company papers above. | business.facebook.com → Settings → Security Centre | Tell me when it's verified |
| 2 | Create a **Meta developer app** (type *Business*), add the **WhatsApp** product | developers.facebook.com → My Apps | The **App ID** (not secret) |
| 3 | Copy the **App Secret** | App → Settings → Basic | Put it in Secret Manager as `META_APP_SECRET` |
| 4 | Choose a random **verify token** (any long random string, e.g. `openssl rand -hex 24`) | — | Secret Manager: `WHATSAPP_VERIFY_TOKEN` |
| 5 | Set the **webhook**: Callback URL `https://<api-domain>/webhooks/whatsapp`, Verify token = #4, subscribe to the **`messages`** field | App → WhatsApp → Configuration | Tell me when Meta shows "verified" |
| 6 | Apply to be a **Tech Provider** and for **Embedded Signup v4**, so merchants connect their own numbers in one click (story E6-4b). Not needed for the first pilot stores. | App → App Review → Permissions (`whatsapp_business_management`, `whatsapp_business_messaging`) | Approval status |

### 1.2 Per pilot store (until Embedded Signup is approved)

| # | Do | Where | Give back |
|---|----|-------|-----------|
| 1 | Add the store's phone number to a WhatsApp Business Account; get the **display name** approved | WhatsApp Manager → Phone numbers | — |
| 2 | Add a **payment method** on that WhatsApp account (Meta bills per delivered template message) | WhatsApp Manager → Billing | — |
| 3 | Create a **system user** with a **permanent token** that has `whatsapp_business_messaging` and `whatsapp_business_management` on that account | Business settings → Users → System users | The store owner pastes it in **Mizan → Settings → Confirmation → Connect WhatsApp**. Never send it to anyone. |
| 4 | Copy the **Phone number ID** and the **WhatsApp Business Account ID** (digits, *not* the phone number) | App → WhatsApp → API setup | Pasted in the same Mizan form |
| 5 | Submit the two **message templates** below, category **Utility**, exactly as written | WhatsApp Manager → Message templates | Mizan checks approval automatically; the connection turns green when approved |

**Template `mizan_order_confirm_ar`** (language: Arabic, category: Utility)

```
{{1}} 👋
أوردرك رقم {{3}} من {{2}} وصلنا.
الإجمالي {{4}}.
أكّد الأوردر عشان نجهّزه ونشحنه لك.
```
Quick-reply buttons, in this order: **أكّد الأوردر** · **عايز أعدّل** · **ألغي الأوردر**

Example values for Meta's review: `{{1}}` = أهلاً منى · `{{2}}` = متجر النيل · `{{3}}` = #1042 · `{{4}}` = 1,250 ج.م. عند الاستلام

**Template `mizan_order_confirm_en`** (language: English, category: Utility)

```
{{1}} 👋
We received your order {{3}} from {{2}}.
Total: {{4}}.
Please confirm so we can prepare and ship it.
```
Quick-reply buttons: **Confirm order** · **I want a change** · **Cancel order**

> 💡 **Keep offers out of these templates.** Meta re-classifies a utility template that promotes anything as *marketing*, which costs more and needs marketing opt-in. Mizan sends the upsell offer later, inside the free chat window that opens when the customer taps.

### 1.3 Decisions for you
- [ ] **Who pays Meta's per-message fees?**
  - The merchant pays directly on their own WhatsApp account (recommended: simplest, no reselling).
  - Or Mizan pays and bills the merchant.
- [ ] **Send me the Meta API docs pages** (or a PDF) for: send message, message templates, webhooks, error codes. The build environment can't reach developers.facebook.com, so these facts are still unconfirmed (also listed in `docs/06-integrations.md` §5):
  1. Graph API version to pin (`v24.0` assumed).
  2. The error codes Mizan treats as "slow down", "bad token" and "template missing": 130429, 131056, 190, 132001.
  3. That code 131047 (24-hour window closed) arrives only in a later delivery receipt.
  4. That Meta echoes our tracking key (`biz_opaque_callback_data`) on every delivery receipt, including failed ones.
  5. That phone numbers can be sent as digits without the `+`.
  6. That a tap on a template button carries our hidden id (`button.payload`).

---

## 2. Shopify 🔴

| # | Do | Where | Give back |
|---|----|-------|-----------|
| 1 | Create a **Shopify Partner** account and an **app** | partners.shopify.com → Apps | — |
| 2 | Set the **App URL** `https://<api-domain>/v1/connections/shopify/entry` and the **redirect URL** `https://<api-domain>/v1/connections/shopify/callback` | App → Configuration | — |
| 3 | Set the compliance webhooks (customers/data_request, customers/redact, shop/redact) to `https://<api-domain>/webhooks/shopify/gdpr` | App → Configuration → Compliance webhooks | — |
| 4 | Copy **Client ID** and **Client secret** | App → Client credentials | Secret Manager: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` |
| 5 | Request **Protected customer data – Level 2** (name, phone, address): we need it to confirm and ship. Justification: order confirmation and delivery; data encrypted; access logged. | App → API access → Protected customer data | Approval status |
| 6 | Create a **development store** with a few products (with SKUs) and COD enabled, for the end-to-end test | Partners → Stores | The store's `.myshopify.com` address |
| 7 | Later 🟡: submit for **App Store review** | Partners → App listing | — |

Scopes Mizan asks for (already in the code): `read_orders, write_orders, write_order_edits, read_products, write_products, read_inventory, write_inventory, read_merchant_managed_fulfillment_orders, write_merchant_managed_fulfillment_orders, read_customers`.

---

## 3. Bosta (courier) 🔴

| # | Do | Where | Give back |
|---|----|-------|-----------|
| 1 | Open a Bosta **business account** (pilot) and generate an **API key** | Bosta dashboard → Settings → API integration | The **merchant** pastes it in Mizan's setup (Courier step). Never in chat. |
| 2 | Get Bosta's **API reference** (PDF or link from your account manager) | Bosta account manager | Send it to me: the numeric state codes, the `deliveries/search` body, the city field and the public tracking link are still unconfirmed |
| 3 | After connecting, paste Mizan's webhook URL (shown in the Courier step) into Bosta's webhook settings | Bosta dashboard | — |

---

## 4. Google Cloud + Firebase (hosting, sign-in, secrets) 🔴

| # | Do | Where | Give back |
|---|----|-------|-----------|
| 1 | A **Google Cloud project** with billing, region **`me-central1` (Doha)** or `me-central2` (Dammam) | console.cloud.google.com | Project ID |
| 2 | **Cloud SQL for PostgreSQL 16**: one instance, staging and production databases | Cloud SQL | Connection names (the passwords go to Secret Manager) |
| 3 | A **Cloud KMS** key ring + key for Mizan's secrets | Security → Key Management | Key resource name → `KMS_KEY_NAME` |
| 4 | **Secret Manager** for the values below; Cloud Run reads them | Security → Secret Manager | — |
| 5 | **Firebase** on the same project: Authentication → Email/Password + Phone; upgrade to **Identity Platform** for SMS second factor (owners); add the dashboard domain to **Authorized domains** | console.firebase.google.com | `FIREBASE_PROJECT_ID` and the web config (`NEXT_PUBLIC_FIREBASE_API_KEY`, `…_AUTH_DOMAIN`, `…_PROJECT_ID`; these are public) |
| 6 | **Domain + DNS**: e.g. `app.<domain>` (dashboard) and `api.<domain>` (API) | Your registrar | The domains (`WEB_URL`, `PUBLIC_URL`) |
| 7 | A **Google Maps Platform** key restricted to the dashboard domain 🟡 | APIs & Services | Secret Manager |

### Values to create (Secret Manager, never in git)

| Name | How to make it |
|------|----------------|
| `LINK_SIGNING_KEY` | `openssl rand -base64 32` (signs confirm links and WhatsApp buttons; rotating it breaks buttons already sent) |
| `META_APP_SECRET` | §1.1 #3 |
| `WHATSAPP_VERIFY_TOKEN` | §1.1 #4 |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | §2 #4 |
| `DATABASE_URL`, `DATABASE_URL_MIGRATOR` | Cloud SQL users: the API user is *not* the owner (see `docs/09-infrastructure.md` §3) |
| `ANTHROPIC_API_KEY` | §5 (when we build E6-12) |

---

## 5. Claude (Anthropic API): AI-written offers (E6-12) 🟡

- [ ] Create an **Anthropic Console** organization for Brandita at console.anthropic.com. Add billing and set a **monthly spend limit** (suggestion: start at USD 50 for the pilot).
- [ ] Create an **API key** for production. Put it in Secret Manager as `ANTHROPIC_API_KEY`.
- [ ] Decision: per-store AI wording switch **on** or **off** by default. I recommend off until each store tries it.

Mizan never sends customer names, phones or addresses to Claude; only products, prices and the store name.

---

## 6. Automated calls (voice / IVR vendor), story E6-8 🟢

- [ ] Choose a vendor that offers **Egyptian (and later Saudi) numbers**, **text-to-speech in Arabic** or recorded prompts, and **a webhook for the pressed digit**.
- [ ] Send me their API docs, and create an account. The key will be pasted in Mizan, not sent in chat.
- Until then: the team calls (the "Needs a call" list in Mizan).

---

## 7. Exchange rates 🟡

- [ ] Confirm the free feed's terms (open.er-api.com: attribution is shown in Settings → Costs). Or pick a licensed / central-bank source before production.

---

## 8. Business decisions still open 🟡

- [ ] **Pricing** in `docs/01-business-model.md`: validate with 3–5 pilot merchants.
- [ ] **Confirmation defaults:**
  - WhatsApp, then wait 2 h, then the team calls (3 tries, 1 h apart, 10:00–22:00): OK?
  - Should the team call **first** for high-value orders?
- [ ] **Upsell rules for the pilot** (E6-11):
  - Max discount (suggestion 15%).
  - One offer per order.
  - Offer only items in stock and margin-positive.
- [ ] **Pilot merchants:** names, WhatsApp numbers, Shopify stores. The business doc lists the open questions.

---

### What happens when each item is done

| You finish | Mizan can then |
|-----------|----------------|
| §1 WhatsApp (one store) + §4 | Confirm that store's orders inside WhatsApp; taps, reasons and changes reach the dashboard |
| §2 Shopify + §4 | Install on a real store, import 60 days of orders and products, sync live |
| §3 Bosta | Create shipments with the right cash amount and track them |
| §5 Claude | AI-picked, AI-worded upsell offers in the chat |
| §6 Voice vendor | Automated calls before the team calls |
