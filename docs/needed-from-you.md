# What Mizan needs from you · المطلوب منك

Everything the code cannot do by itself: accounts, approvals, keys and decisions. The items are in priority order. Each one says **what to do**, **where to do it**, and **what to give back** (and where to put it).

> ⚠️ **Never paste a secret (token, API key, app secret) in chat, an issue or a commit.** Each secret has its place below: Azure Key Vault, or the form inside Mizan where a merchant pastes their own key. Mizan stores them encrypted and never shows them again.

Legend: 🔴 blocks the pilot · 🟡 needed before launch · 🟢 later phase

---

## 0. Company paperwork (needed by almost every platform) 🔴

Meta, Shopify, payment gateways and couriers all ask for these before granting access:

- [ ] Commercial registration and tax card (Egypt) for the company that owns Mizan / Brandita.
- [ ] A public website on Mizan's domain with a **privacy policy** and **terms of service** (Arabic and English).
- [ ] A short **data protection document**:
  - encryption (Azure Key Vault RSA key + per-store keys);
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
| 3 | Copy the **App Secret** | App → Settings → Basic | Put it in Azure Key Vault as `meta-app-secret` (env `META_APP_SECRET`; see "Values to create") |
| 4 | Choose a random **verify token** (any long random string, e.g. `openssl rand -hex 24`) | — | Azure Key Vault: `whatsapp-verify-token` (env `WHATSAPP_VERIFY_TOKEN`) |
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
| 4 | Copy **Client ID** and **Client secret** | App → Client credentials | Configure `SHOPIFY_API_KEY` as plain API environment; put the secret in Azure Key Vault as `shopify-api-secret` (env `SHOPIFY_API_SECRET`) |
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

## 4. Azure + Firebase (hosting, sign-in, secrets) 🔴

| # | Do | Where | Give back |
|---|----|-------|-----------|
| 1 | An **Azure subscription** with billing in **UAE North (`uaenorth`)**; run the bootstrap script once per environment | Azure Cloud Shell | Subscription ID |
| 2 | **Azure Database for PostgreSQL Flexible Server 16**: Terraform creates the server, `mizan` database and generated credentials | `infra/bootstrap.sh` | No database passwords to send; Terraform stores generated values in Key Vault |
| 3 | **Azure Key Vault** with RBAC, soft delete and purge protection; Terraform creates the RSA 3072 `tenant-secrets` key | `infra/bootstrap.sh` | `KEY_VAULT_KEY_ID` is output by Terraform |
| 4 | 🚧 **Firebase**: project `mizan-8f906` and web config already exist. Firebase Authentication remains separate from Azure hosting: configure Email/Password + Phone, SMS second factor (owners), add the dashboard domain to **Authorized domains**, allow SMS only to +20/+966/+971 (Authentication → Settings → SMS region policy), and restrict the public web API key to dashboard origins and Identity Toolkit (Google Cloud → APIs & Services → Credentials). No Google Analytics (consent rules; Mizan keeps its own product events) | console.firebase.google.com | `FIREBASE_PROJECT_ID` and web config (`NEXT_PUBLIC_FIREBASE_API_KEY`, `…_AUTH_DOMAIN`, `…_PROJECT_ID`; public by design) |
| 5 | **Domain + DNS**: `api.mizan.brandita.net`, `app.mizan.brandita.net` (later `admin.mizan.brandita.net`); add the Terraform CNAME and `asuid` TXT records, set `bind_custom_domains = true`, then re-run `infra/bootstrap.sh` to bind the certificates | Hostinger | After binding, set GitHub `API_URL` to the API's HTTPS domain |
| 6 | A **Google Maps Platform** key restricted to the dashboard domain 🟡 | APIs & Services | Azure Key Vault |
| 7 | The **email of the first Mizan staff super admin** (the back office, A-1). That person signs in with the email verified and a second factor; they then add the rest of the staff | — | `PLATFORM_BOOTSTRAP_EMAILS` (not a secret: an Azure Container App environment variable) |

### Values to create (Azure Key Vault, never in git)

Key Vault secret names allow only letters, digits and dashes, so each value goes in under the
kebab-case name below. For each one: `az keyvault secret set --vault-name <vault> --name <key-vault-name> --value '<value>'`
(Cloud Shell; `terraform output provider_secrets_to_fill` prints the exact commands), then add the
env name to `provider_secrets` in `infra/envs/<env>.tfvars` and re-run `infra/bootstrap.sh`. The
API only receives secrets listed there.

| Key Vault name | Env name | How to make it |
|----------------|----------|----------------|
| `meta-app-secret` | `META_APP_SECRET` | §1.1 #3 |
| `whatsapp-verify-token` | `WHATSAPP_VERIFY_TOKEN` | §1.1 #4 |
| `shopify-api-secret` | `SHOPIFY_API_SECRET` | §2 #4 |
| `anthropic-api-key` | `ANTHROPIC_API_KEY` | §5 (when we build E6-12) |
| `sentry-dsn` | `SENTRY_DSN` | Optional |

**Generated by Terraform, nothing to create:** `LINK_SIGNING_KEY` (signs confirm links and
WhatsApp buttons; rotating it breaks buttons already sent), `METRICS_TOKEN`, `DATABASE_URL`,
`DATABASE_URL_MIGRATOR` and `DATABASE_APP_PASSWORD`. Migrations use the schema-owner login and the
API login is a separate RLS-scoped role (see `docs/09-infrastructure.md` §3). Do not create these
by hand: Terraform owns them and would overwrite or conflict with a manual value.

---

## 5. Claude (Anthropic API): AI-written offers (E6-12) 🟡

- [ ] Create an **Anthropic Console** organization for Brandita at console.anthropic.com. Add billing and set a **monthly spend limit** (suggestion: start at USD 50 for the pilot).
- [ ] Create an **API key** for production. Put it in Azure Key Vault as `anthropic-api-key` (env `ANTHROPIC_API_KEY`), see "Values to create".
- [ ] Decision: per-store AI switch **on** or **off** by default. It's built **off**; each store turns it on in Settings → Offers. Model: `claude-opus-5-5` (change with `ANTHROPIC_MODEL`).

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
- [ ] **Upsell rules for the pilot** (E6-11, built: off by default; turn it on in Settings → Offers):
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
