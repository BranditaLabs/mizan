# DNS on Hostinger: brandita.net with Mizan staging

The full record set for brandita.net when DNS moves from Cloudflare back to Hostinger. It keeps the
website and email working and adds the Mizan staging hosts on Azure Container Apps (UAE North).
Mizan values are from `terraform output dns_records` after the first staging apply (31 Oct 2026).
For DNS staying on Cloudflare, see `dns-cloudflare.md`.

## 1. Before you start

As of 2 Nov 2026 the brandita.net nameservers are Cloudflare's (`cosmin`/`rachel.ns.cloudflare.com`),
and Hostinger's zone is almost empty (only `www`). **Add every record below in Hostinger first, and
switch the nameservers last** (section 4), or the website and email go down.

Two values must be read from the live setup; they are not visible from outside:

- **Website IP**: Cloudflare → brandita.net → DNS → Records, the `A` record on `@` (the public
  answer is Cloudflare's proxy, not the server). If the site is hosted on Hostinger, hPanel →
  Websites → brandita.net → Dashboard shows it too.
- **Amazon SES DKIM** (only if mail is sent from @brandita.net through SES): AWS → SES → Identities →
  brandita.net lists three `CNAME`s. Copy any other record you find in Cloudflare (verification
  `TXT`s, `SPF`, `DMARC`) as well.

## 2. Records

hPanel → **Domains → brandita.net → DNS / Nameservers → DNS records**. A banner may say the domain does
not use Hostinger's nameservers; records can still be added. Name holds only the part before
`brandita.net`. Click **Add Record** for each row and check it appears in the list.

### Website and email (keep what works today)

| Type | Name | Points to / Content | Priority | TTL |
| --- | --- | --- | --- | --- |
| A | `@` | *website IP (section 1)* | | 3600 |
| CNAME | `www` | `brandita.net` (already present) | | 3600 |
| MX | `@` | `inbound-smtp.eu-west-1.amazonaws.com` | 10 | 3600 |
| CNAME | `<token>._domainkey` (×3) | `<token>.dkim.amazonses.com` (from SES, if present) | | 3600 |

Delete Hostinger defaults that conflict (a parking `A @`, an `MX` to Hostinger mail).

### Mizan staging

| Type | Name | Points to / Content | TTL |
| --- | --- | --- | --- |
| CNAME | `api.mizan` | `ca-mizan-api.kindmushroom-ffbe7621.uaenorth.azurecontainerapps.io` | 3600 |
| CNAME | `app.mizan` | `ca-mizan-web.kindmushroom-ffbe7621.uaenorth.azurecontainerapps.io` | 3600 |
| CNAME | `mizan` | `ca-mizan-web.kindmushroom-ffbe7621.uaenorth.azurecontainerapps.io` | 3600 |
| CNAME | `admin.mizan` | `ca-mizan-admin.kindmushroom-ffbe7621.uaenorth.azurecontainerapps.io` | 3600 |
| TXT | `asuid.api.mizan` | `3C791EBD1EA356DF309363CD1EDB1847A3F76CF2662A8C3B6E0F2B04585076B4` | 3600 |
| TXT | `asuid.app.mizan` | `3C791EBD1EA356DF309363CD1EDB1847A3F76CF2662A8C3B6E0F2B04585076B4` | 3600 |
| TXT | `asuid.mizan` | `3C791EBD1EA356DF309363CD1EDB1847A3F76CF2662A8C3B6E0F2B04585076B4` | 3600 |
| TXT | `asuid.admin.mizan` | `3C791EBD1EA356DF309363CD1EDB1847A3F76CF2662A8C3B6E0F2B04585076B4` | 3600 |

- `mizan` and `app.mizan` point at the same app: the dashboard serves the landing page when the
  request's host is `mizan.brandita.net`.
- The `asuid` value is the Container Apps environment's domain verification id, public by design.

## 3. Check before switching

Ask Hostinger's nameserver directly (works before the switch):

```
nslookup -type=CNAME api.mizan.brandita.net ns1.dns-parking.com
nslookup -type=TXT asuid.api.mizan.brandita.net ns1.dns-parking.com
nslookup -type=A brandita.net ns1.dns-parking.com
nslookup -type=MX brandita.net ns1.dns-parking.com
```

Every answer must match the tables. Repeat for `app.mizan`, `mizan` and `admin.mizan`.

## 4. Switch the nameservers

hPanel → **Domains → brandita.net → DNS / Nameservers → Change nameservers → Use Hostinger
nameservers** (`ns1.dns-parking.com`, `ns2.dns-parking.com`). `.net` delegation can take up to 24–48
hours to reach every resolver. The website is then served directly, without Cloudflare's proxy.

## 5. Then

Bind the certificates and update GitHub, Firebase and Shopify as in `dns-cloudflare.md` sections 4–5.
