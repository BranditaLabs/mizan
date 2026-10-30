# 15 — Go-live plan: launch track and feature track in parallel

> **Status:** plan v1, 30 Oct 2026. "Live" means **Gate 2: Mizan in production with the first 10 pilot stores** on real orders (Egypt, Shopify, Bosta, COD-first, every payment method recorded). Two tracks run at the same time: **Launch** (get it live and keep it live) and **Features** (the growth hub, `docs/14`). Owner = **O**; engineering (Claude Code + reviewer) = **E**.
>
> **بالمصري:** خطين شغالين مع بعض: خط يطلّع ميزان لايف مع أول 10 متاجر في حوالي 6 أسابيع، وخط تاني بيبني المزايا الجاية (العائد لكل حملة، العملاء) من غير ما يأخّر الإطلاق.

## 1. What "live" includes (pilot scope)

| In the pilot | How it runs on day 1 | Upgrades when ready |
| --- | --- | --- |
| Shopify orders, sync, profit, stock, returns, tickets, reports | ✅ Built | — |
| Confirmation | **Team calls** (built: "Needs a call" queue, script, outcomes) | WhatsApp in the chat once each store's number and templates are approved |
| Shipping with Bosta | Booking, tracking, statuses (built), with the store's own Bosta key | Labels from Mizan once Bosta's AWB endpoint is confirmed; until then printed from Bosta's dashboard |
| Couriers without an API (J&T…) | Recorded by hand, statuses by CSV (built) | J&T API when access is granted |
| Payments | Ledger, manual entries, COD to prepaid with InstaPay/wallet details (built) | Paymob links and refunds (E14-2) |
| Warehouse app (Android) | Counts, pick and pack, receiving (built) | Sign-in with each team member's account (E8-4b, needs Firebase app config) |
| Billing | **Free pilot** (3 months, D-5 agreement), usage tracked (built) | Paymob subscription billing (E12-2) before Gate 3 |
| Ads | True ROAS from spend entered or imported (built, M7-1) | Per campaign (G1 below) |

**Not in the pilot:** the Shopify App Store listing (pilots install a custom-distribution app), KSA, marketplaces, POS.

## 2. Timeline at a glance

```
Week          1        2        3        4        5        6        7        8        9       10
LAUNCH   ├─ L0 staging ─┤├─ L1 harden + legal ─┤├─ L2 production ─┤├─ L3 pilots 1–3 ─┤├─ L4 pilots 4–10 ─► Gate 2
FEATURES ├────────── G1 Know: source capture, campaign ROAS, CTWA, digest ──────────┤├──── G2 CRM: profiles, consent, segments ────►
SUPPORT                                                    └── 30% of engineering on pilot fixes from week 5 ──►
OWNER    ├─ applications: Shopify app + data L2 · Meta verification · Bosta business · TikTok/Google/Snap apps · lawyer ─►
```

The launch track never waits for the feature track. Features go to production behind **feature flags** (built, A-6) and reach pilots when ready.

## 3. Launch track (L)

### L0 · Staging up (week 1)

| # | Task | Who | Status / needs |
| --- | --- | --- | --- |
| L0-1 | Run `infra/bootstrap.sh mizan-8f906 me-central1 staging` in Cloud Shell; paste the printed GitHub variables into the **staging** environment | O | Waiting on the run |
| L0-2 | First deploy from `main`; fill `public_url`/`web_url` from the outputs; second apply | E + O | After L0-1 |
| L0-3 | **Deploy the back office** (`apps/admin`) as a Cloud Run service, with its URL in the API's CORS (`ADMIN_URL`) | E | Terraform not written yet; can start now |
| L0-4 | Firebase: Auth (email, phone, SMS second step) on the staging project; authorised domains; SMS region policy allows Egypt | O + E | Firebase console |
| L0-5 | Staging smoke: `deploy/compose/smoke.sh` against the URLs; the web and admin browser suites against staging | E | After L0-2 |
| L0-6 | **H-13 load test** at full targets (1,000 reads/s, 500 writes/s) on staging | E | After L0-2 |

### L1 · Harden, legal, operations (weeks 2–3)

| # | Task | Who | Notes |
| --- | --- | --- | --- |
| L1-1 | **Security pass:** Strix scan of the repo and staging, `/security-review` on the whole API, fix every high and medium finding | E | External pen test (E13-4) is booked for before the public launch, not before pilots `[O: confirm]` |
| L1-2 | **Legal:** the lawyer reviews `docs/legal/`; fill in the placeholders | O | Drafts done (E13-3) |
| L1-3 | **Legal pages and acceptance:** `/ar/legal/*` and `/en/legal/*`; sign-up records which version of the terms + DPA was accepted, per store; re-accept when the version changes | E | Can be built now; the text goes in after L1-2 |
| L1-4 | **Shopify custom-distribution app** for the pilots: Partner app, scopes, protected customer data Level 2 request, and an install link per pilot store | O + E | Start week 1; approval may take 1–3 weeks |
| L1-5 | **Warehouse app release:** signed Android build, Play Console internal testing track, install guide AR/EN | E + O | Play developer account (O) |
| L1-6 | **Runbooks:** pilot onboarding (done-for-you checklist), support (who answers, response times, WhatsApp support number), incident (from `docs/09`), daily health check | E + O | |
| L1-7 | **Pilot measurement baseline:** a "Pilot" dashboard (orders, delivered rate, refusal rate, cost per delivered order, profit per completed order, automation share) from the metric layer, weekly CSV | E | Metric layer built |
| L1-8 | **In-app feedback:** a "Send feedback" button that opens a ticket for the Mizan team with the page and store | E | Small |

### L2 · Production (week 4)

| # | Task | Who | Notes |
| --- | --- | --- | --- |
| L2-1 | `bootstrap.sh <prod-project> me-central1 production`; GitHub **production** environment with required reviewers; deploy by `v*` tag | O + E | `deploy-prod.yml` built |
| L2-2 | **Domains:** `app.`, `api.`, `admin.` on the chosen domain, mapped to Cloud Run; HTTPS; Firebase authorised domains | O + E | Domain choice (O) |
| L2-3 | Secrets in Secret Manager (Shopify app keys, Anthropic, link signing, etc.); alert emails for monitoring | O + E | Never in chat or the repo |
| L2-4 | **Restore drill** from backup into a scratch instance (`docs/runbooks/database-restore.md`), timed and written down | E | Before the first real order |
| L2-5 | **Go / no-go review** (section 5) | O + E | |

### L3 · First 3 pilots (week 5–6), L4 · pilots 4–10 (weeks 7–9)

| # | Task | Who |
| --- | --- | --- |
| L3-1 | Done-for-you onboarding per store: install the app, backfill 90 days, product costs (CSV), cost rules, Bosta key, team invites, confirmation by team calls, warehouse app on phones | O + E |
| L3-2 | Daily check for the first 2 weeks: sync gaps (nightly reconciliation, built), dead letters, unknown courier statuses, profit flags | E |
| L3-3 | Weekly call with each pilot; feedback into the backlog (P-3); fix within the week for blockers | O + E |
| L3-4 | WhatsApp confirmation switched on per store as its number and templates are approved | O + E |
| L4-1 | Pilots 4–10 the same way, two or three a week | O + E |

## 4. Feature track (F), in parallel

Engineering split from week 1: **launch tasks first each day, features in the rest**; from week 5, **30% of capacity stays on pilot fixes**.

| Weeks | Ships | From `docs/14` | Why now |
| --- | --- | --- | --- |
| 1–3 | Order source capture, backfilled | M7-2 | No approvals; pilots see where orders came from from day 1 |
| 2–4 | True ROAS per platform, campaign and ad; fake-order alerts; click-to-WhatsApp attribution | M7-3, M7-4 | The number pilots (and Brandita) want most |
| 4–5 | Break-even ROAS, daily digest, UTM/link builder, post-purchase survey | AN-3, AN-4, TK-1, TK-8 | Small, visible wins for pilots |
| 5–9 | Customer profiles (net LTV), consent centre, segments, cohorts | CRM-1…3, AN-2 | The base for campaigns and audiences |
| 7–12 | Conversion events to Meta, TikTok and Snap with the merchant's token | FB-1…3, FB-5 | Once pilots have delivered data to send |
| After Gate 2 | Campaigns, flows, loyalty, then the approval-gated pieces | G4, G5 | Needs WhatsApp marketing templates and platform approvals |

**Also queued for when the owner's accounts arrive:** Paymob (E14-2, E12-2), J&T (E7-5), Bosta labels, Meta Embedded Signup (E6-4b), SMS/voice (E6-8), EasyOrders (E5-6).

## 5. Go / no-go checklist (L2-5)

- [ ] Staging: smoke, browser suites and load test (H-13) green; no open high or medium security finding.
- [ ] Production: deployed from a tag, migrations applied, `/health/ready` up, uptime and alerts reaching the on-call email.
- [ ] Restore drill done, with the time to restore recorded.
- [ ] Shopify app approved for protected customer data (Level 2) and installs on a test store; GDPR webhooks answer.
- [ ] Legal pages published (lawyer-approved); sign-up records acceptance.
- [ ] Support: number, hours, runbooks, and who is on call in the first two weeks.
- [ ] Pilot agreements signed (D-5); the first three stores' costs and Bosta keys ready.

## 6. Owner's list, in order of urgency

| When | Action | Unblocks |
| --- | --- | --- |
| **Today** | Run the staging bootstrap and paste the output | L0 (everything) |
| **Week 1** | Shopify Partner app + protected data request; Firebase project access; Play Console account; domain choice | L1-4, L0-4, L1-5, L2-2 |
| **Week 1** | Lawyer engaged on `docs/legal/` | L1-2 |
| **Week 1** | Meta business verification; the WhatsApp number per pilot store; Bosta business account (labels) | WhatsApp confirmation, labels |
| **Week 1–2** | TikTok, Google Ads, Snap developer apps; Paymob merchant account | Feature track G3+, payments |
| **Week 2** | Pick and sign the 10 pilots (D-5); collect their product costs and Bosta keys | L3 |
| **Week 3** | Production Google Cloud project (Doha) and billing | L2 |

## 7. Risks to the date

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Shopify protected-data approval is slow | Pilots can't install | Apply in week 1; meanwhile pilots can run on manual and phone orders (built) |
| Staging bootstrap blocked (permissions, org policy) | Everything slips | Run together in a session; `infra/README` troubleshooting |
| WhatsApp approvals slow | No chat confirmation | Team calls are the day-1 channel (built) |
| A pilot's data breaks an assumption (Bosta states, odd orders) | Wrong numbers | Engine's drift handling + review queues (built); daily check in L3 |
| One engineer split across two tracks | Features slip | Launch first each day; features behind flags; 30% fix budget |
