# DNS on Cloudflare: Mizan staging on brandita.net

The records that point Mizan's staging hosts at Azure Container Apps (UAE North), entered in
Cloudflare. Values are from `terraform output dns_records` after the first staging apply
(31 Oct 2026). If the environment is rebuilt, take fresh values from that output.

| Host | Serves |
| --- | --- |
| `api.mizan.brandita.net` | API (Shopify webhooks and OAuth land here) |
| `app.mizan.brandita.net` | Merchant dashboard |
| `mizan.brandita.net` | Landing page (the dashboard app, `MARKETING_HOST`) |
| `admin.mizan.brandita.net` | Back office (Mizan staff) |

## 1. Put brandita.net on Cloudflare (once)

Skip this if brandita.net is already a Cloudflare zone.

1. Cloudflare dashboard → **Add a domain** → `brandita.net` → Free plan.
2. Cloudflare imports the existing records. Before you continue, check they match what Hostinger has
   today (website, email `MX`, `SPF`/`DKIM`/`DMARC` `TXT`). A missing email record stops email.
3. Cloudflare shows two nameservers (for example `xxx.ns.cloudflare.com`).
4. Hostinger → **Domains → brandita.net → DNS / Nameservers → Change nameservers** → enter the two
   Cloudflare nameservers.
5. Wait until Cloudflare says the zone is **Active** (minutes to a few hours).

From then on DNS is managed in Cloudflare only; records added at Hostinger have no effect.

## 2. Records

Cloudflare → `brandita.net` → **DNS → Records → Add record**. Cloudflare appends `brandita.net` to
each name. TTL: Auto.

| Type | Name | Target / Content | Proxy status |
| --- | --- | --- | --- |
| CNAME | `api.mizan` | `ca-mizan-api.kindmushroom-ffbe7621.uaenorth.azurecontainerapps.io` | **DNS only** (grey cloud) |
| CNAME | `app.mizan` | `ca-mizan-web.kindmushroom-ffbe7621.uaenorth.azurecontainerapps.io` | **DNS only** |
| CNAME | `mizan` | `ca-mizan-web.kindmushroom-ffbe7621.uaenorth.azurecontainerapps.io` | **DNS only** |
| CNAME | `admin.mizan` | `ca-mizan-admin.kindmushroom-ffbe7621.uaenorth.azurecontainerapps.io` | **DNS only** |
| TXT | `asuid.api.mizan` | `3C791EBD1EA356DF309363CD1EDB1847A3F76CF2662A8C3B6E0F2B04585076B4` | n/a |
| TXT | `asuid.app.mizan` | `3C791EBD1EA356DF309363CD1EDB1847A3F76CF2662A8C3B6E0F2B04585076B4` | n/a |
| TXT | `asuid.mizan` | `3C791EBD1EA356DF309363CD1EDB1847A3F76CF2662A8C3B6E0F2B04585076B4` | n/a |
| TXT | `asuid.admin.mizan` | `3C791EBD1EA356DF309363CD1EDB1847A3F76CF2662A8C3B6E0F2B04585076B4` | n/a |

- `mizan` and `app.mizan` point at the same app: the dashboard serves the landing page when the
  request's host is `mizan.brandita.net`.
- The `asuid` value is the Container Apps environment's domain verification id; it is public by design
  and the same for every host.
- Make sure no other record already uses one of these names (a CNAME cannot share its name).

### Why "DNS only"

Azure issues and renews the free managed certificates by checking that each host's CNAME resolves to
the app. With the orange cloud (proxied), the name resolves to Cloudflare's addresses instead, so the
certificate cannot be issued, and an issued one stops renewing (silently, after about six months).
Keep all four hosts on **DNS only**.

If you later want Cloudflare's proxy or WAF in front of Mizan, that is a separate change: bring your own
certificate to Container Apps (Cloudflare origin certificate or another CA), set SSL/TLS to
**Full (strict)**, and only then turn the proxy on. Ask before doing it.

## 3. Check the records

From any terminal, once Cloudflare shows them:

```
nslookup -type=CNAME api.mizan.brandita.net 1.1.1.1
nslookup -type=TXT asuid.api.mizan.brandita.net 1.1.1.1
```

The first should return `ca-mizan-api.kindmushroom-ffbe7621.uaenorth.azurecontainerapps.io`, the
second the verification id. Repeat for `app.mizan`, `mizan` and `admin.mizan`.

## 4. Bind the certificates

1. In `infra/envs/staging.tfvars` set `bind_custom_domains = true`.
2. Run `bash infra/bootstrap.sh <subscription-id> uaenorth staging` again (Cloud Shell, or this PC). It
   adds the hostnames, issues one managed certificate per host and binds it (`az containerapp hostname
   bind`).
3. Open `https://api.mizan.brandita.net/health/ready`, `https://app.mizan.brandita.net/ar`,
   `https://mizan.brandita.net/` and `https://admin.mizan.brandita.net/ar`: each should show a valid
   certificate.

## 5. After binding

- GitHub → Environments → **staging** → variables: `API_URL = https://api.mizan.brandita.net`,
  `APP_URL = https://app.mizan.brandita.net`, then redeploy (the dashboard is built against `API_URL`).
- Firebase console → Authentication → Settings → **Authorized domains**: `app.mizan.brandita.net`,
  `admin.mizan.brandita.net`. Allow the same origins (and `mizan.brandita.net`) in the web API key's
  HTTP referrer restriction.
- Shopify app → URLs: App URL `https://api.mizan.brandita.net/v1/connections/shopify/entry`, allowed
  redirection URL `https://api.mizan.brandita.net/v1/connections/shopify/callback`.
- WhatsApp webhook (when set up): `https://api.mizan.brandita.net/webhooks/whatsapp`.

Production gets its own hosts and records from its own `terraform output dns_records`; do not reuse
these values.
