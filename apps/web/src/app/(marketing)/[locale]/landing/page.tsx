import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { CSSProperties, ReactNode } from "react";
import { Faq, LandingRoot, LanguageButton, PricingToggles, ThemeButton } from "@/components/landing/client";
import { LIcon, type IconPath } from "@/components/landing/icons";
import { branditaHref, demoHref, legalHref, partnersHref, signInHref, signUpHref } from "@/components/landing/links";
import "@/components/landing/landing.css";
import { THEME_COOKIE } from "@/lib/theme";

/**
 * The public landing page (L1-9), as the "Landing page · glass" board of the Mizan Glass canvas.
 * Served at /{locale}/landing, and at "/", "/ar", "/en" of the marketing host (MARKETING_HOST, proxy.ts).
 * Copy: messages/landing/{ar,en}.json. Everything is HTML, CSS and SVG: no images, no third-party scripts.
 */
type Props = { params: Promise<{ locale: string }> };

/** Built ahead of time for both languages (the layout reads no cookie). */
export const generateStaticParams = () => [{ locale: "ar" }, { locale: "en" }];

/**
 * The public address the SEO tags point at: the marketing host, else the app URL, else the production
 * marketing host, so canonical, hreflang and og:url are always absolute. Set MARKETING_HOST (or
 * NEXT_PUBLIC_APP_URL) in every deployed environment so staging does not claim the production address.
 */
const SITE_FALLBACK = "https://mizan.brandita.net";

const otherPath = (locale: string) => (process.env.MARKETING_HOST ? `/${locale}` : `/${locale}/landing`);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing.meta" });
  const host = process.env.MARKETING_HOST;
  const site = host ? `https://${host}` : process.env.NEXT_PUBLIC_APP_URL || SITE_FALLBACK;
  return {
    metadataBase: new URL(site),
    title: { absolute: t("title") },
    description: t("description"),
    alternates: { canonical: otherPath(locale), languages: { ar: otherPath("ar"), en: otherPath("en"), "x-default": otherPath("ar") } },
    openGraph: { type: "website", title: t("title"), description: t("description"), siteName: t("siteName"), locale: locale === "ar" ? "ar_EG" : "en_US", url: otherPath(locale) },
    robots: { index: true, follow: true },
  };
}

/* Example data shown in the product previews (numbers stay as they are in both languages). */
const KPIS = [["kpiProfit", "181,680"], ["kpiDelivered", "81.6%"], ["kpiCash", "164,200"]] as const;
const MENU: [string, IconPath][] = [["home", "home"], ["orders", "orders"], ["verification", "verify"], ["payments", "card"], ["shipping", "ship"], ["profit", "profit"], ["automations", "auto"]];
const SHIPPED_ID = "#EO-48302";
const LIVE = ["Shopify", "Bosta", "WhatsApp"];
const SOON = ["Paymob", "Mylerz", "J&T Express", "Salla", "Zid"];
const LEAKS: [string, IconPath][] = [["door", "risk"], ["cash", "cod"], ["profit", "profit"]];
const STEPS: [string, IconPath][] = [["order", "orders"], ["confirm", "verify"], ["ship", "ship"], ["reconcile", "recon"]];
const METHODS: [string, IconPath][] = [["cod", "cod"], ["card", "card"], ["wallet", "wallet"], ["deposit", "deposit"], ["bnpl", "bnpl"], ["bank", "bank"]];
const RECIPES = ["paid", "deposit", "chase", "lowStock", "winBack", "short"];
const FLOW: [string, IconPath, string][] = [["when", "orders", "order.created"], ["if", "risk", "risk.score"], ["send", "send", "whatsapp.send"], ["ship", "ship", "bosta.ship"]];
const DOMAINS = ["operate", "money", "grow", "platform"];
const PNL = [["total", "2,100"], ["cost", "−920"], ["shipping", "−85"], ["fees", "−38"], ["ads", "−545"]] as const;
const MODULES: [string, IconPath][] = [["warehouse", "warehouse"], ["inbox", "inbox"], ["recon", "recon"], ["pos", "pos"], ["ai", "ai"], ["returns", "undo"], ["purchasing", "layers"]];
const POINTS = ["screens", "dialect", "numbers"];
const TOOLS = ["confirm", "couriers", "stock", "inbox", "profit"];
const CHART = "M0 106C4 103 17 93 26 88C35 83 44 80 52 76C61 72 70 66 79 65C87 65 96 71 105 73C114 74 122 65 131 72C140 78 149 107 157 113C166 119 175 111 183 109C192 107 201 100 210 102C218 103 227 117 236 119C245 120 253 108 262 111C271 114 280 134 288 135C297 135 306 117 314 112C323 108 332 112 341 108C349 103 358 90 367 84C376 78 384 71 393 72C402 72 411 84 419 85C428 86 437 78 446 77C454 76 463 81 472 79C480 77 489 65 498 65C507 66 515 74 524 82C533 90 542 111 550 114C559 117 568 97 577 98C585 100 594 124 603 124C611 125 620 106 629 104C638 102 646 113 655 113C664 113 673 114 681 105C690 96 699 66 708 60C716 55 725 72 734 73C743 73 756 66 760 65";
const MONO_M = "M66 0V536H201L204 449Q224 496 262.5 522.0Q301 548 350 548Q408 548 447.0 518.5Q486 489 503 439Q522 492 561.5 520.0Q601 548 654 548Q736 548 785.0 496.0Q834 444 834 345V0H684V303Q684 429 603 429Q562 429 539.5 395.5Q517 362 517 301V0H382V301Q382 363 364.0 396.0Q346 429 302 429Q261 429 238.5 395.0Q216 361 216 301V0Z";

/** Order ids left to right in Geist Mono, amounts isolated, inside text of either direction. */
const rich = {
  id: (c: ReactNode) => <bdi dir="ltr" className="mono">{c}</bdi>,
  n: (c: ReactNode) => <bdi className="num">{c}</bdi>,
};
const delay = (d: string) => ({ "--d": d }) as CSSProperties;

/**
 * Runs while the HTML is parsed, before the first paint: the prerendered page is dark, so a person who
 * chose light gets it without a flash (the same `mizan-theme` cookie as the app). Rendered here, in the
 * server component, because React does not server-render a <script> from a client component.
 */
const NO_FLASH = `try{if(/(?:^|;\\s*)${THEME_COOKIE}=light(?:;|$)/.test(document.cookie)){document.currentScript.parentElement.classList.add("light");document.documentElement.dataset.theme="light"}}catch(e){}`;

/** The wordmark from public/brand, for both themes (the CSS shows the one that matches). */
function Wordmark({ locale, alt, className = "" }: { locale: string; alt: string; className?: string }) {
  const ar = locale === "ar";
  const file = (dark: boolean) => `/brand/mizan-wordmark${ar ? "-ar" : ""}${dark ? "-on-dark" : ""}.svg`;
  const [w, h] = ar ? [62, 28] : [80, 22];
  return (
    <span className={`lp-wm ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG */}
      <img src={file(true)} alt={alt} width={w} height={h} className="lp-wm-dark" />
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG */}
      <img src={file(false)} alt={alt} width={w} height={h} className="lp-wm-light" />
    </span>
  );
}

function SectionHead({ eyebrow, title, lead, center = false, id }: { eyebrow: string; title: string; lead?: string; center?: boolean; id: string }) {
  return (
    <div className={`sec-head reveal ${center ? "center" : ""}`}>
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="h2 disp" id={id}>{title}</h2>
      {lead ? <p className="lead">{lead}</p> : null}
    </div>
  );
}

export default async function LandingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("landing");
  const money = (amount: string) => t("money", { amount });

  return (
    <LandingRoot>
      <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      <a href="#main" className="mz-sr lp-skip">{t("skip")}</a>
      {/* ───── Navigation ───── */}
      <header className="wrap lp-top">
        <nav className="g lp-nav" aria-label={t("nav.label")}>
          <a href="#top" className="lp-logo"><Wordmark locale={locale} alt={t("logoAlt")} /></a>
          <div className="lp-navlinks">
            <a className="navlink" href="#product">{t("nav.product")}</a>
            <a className="navlink" href="#payments">{t("nav.payments")}</a>
            <a className="navlink" href="#automations">{t("nav.automations")}</a>
            <a className="navlink" href="#pricing">{t("nav.pricing")}</a>
            <a className="navlink" href="#faq">{t("nav.faq")}</a>
          </div>
          <div className="lp-nav-end">
            <LanguageButton />
            <ThemeButton />
            <a className="btn btn-glass btn-sm lp-signin" href={signInHref(locale)}><LIcon name="signIn" flip className="lp-signin-icon" /><span className="lp-signin-text">{t("nav.signIn")}</span></a>
            <a className="btn btn-primary btn-sm" href={signUpHref(locale)}>{t("nav.start")}</a>
          </div>
        </nav>
      </header>

      <main id="main">
        {/* ───── Hero ───── */}
        <section id="top" className="wrap lp-hero" aria-labelledby="lp-h1">
          <a className="chip plain rise lp-hero-chip" href="#how" style={delay(".05s")}>
            <span className="live red lp-dot" aria-hidden="true" />
            <span>{t("hero.eyebrow")}</span>
            <span className="chip plain lp-chip-cta">{t("hero.eyebrowCta")}</span>
          </a>
          <h1 id="lp-h1" className="disp rise lp-h1" style={delay(".12s")}>
            <span>{t("hero.h1a")}</span>
            <span className="lp-h1-accent">{t("hero.h1b")}</span>
          </h1>
          <p className="lead rise lp-hero-sub" style={delay(".2s")}>{t("hero.sub")}</p>
          <div className="rise lp-ctas" style={delay(".28s")}>
            <a className="btn btn-primary btn-lg" href={signUpHref(locale)}>{t("nav.start")}<LIcon name="arrow" flip /></a>
            <a className="btn btn-glass btn-lg" href={demoHref}>{t("hero.demo")}</a>
          </div>
          <span className="faint rise lp-note" style={delay(".34s")}>{t("hero.note")}</span>

          {/* The dashboard preview: HTML and SVG, not a picture. Charts and numbers stay left to right. */}
          <div className="rise lp-preview" style={delay(".42s")} role="img" aria-label={t("hero.preview")}>
            <div className="tilt" aria-hidden="true">
              <div className="g g-lift lp-board">
                <div className="g-2 lp-menu">
                  {MENU.map(([k, icon], i) => (
                    <span key={k} className={`lp-menu-item ${i === 0 ? "on" : ""}`}><LIcon name={icon} size={16} />{t(`hero.menu.${k}`)}</span>
                  ))}
                </div>
                <div className="lp-board-main">
                  <div className="lp-kpis">
                    {KPIS.map(([k, v], i) => (
                      <div key={k} className={`g-2 lp-kpi ${i === 0 ? "hero-tile" : ""}`}>
                        {i === 0 ? <span className="halo" /> : null}
                        <span className="muted lp-kpi-label">{t(`hero.${k}`)}</span>
                        <bdi className="disp num lp-kpi-value">{v}</bdi>
                      </div>
                    ))}
                  </div>
                  <div className="g-2 lp-chart">
                    <svg viewBox="0 0 760 214">
                      <defs><linearGradient id="lp-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".2" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
                      <path d="M0 64H760M0 114H760M0 164H760" style={{ stroke: "var(--line)" }} />
                      <path className="fade-in" fill="url(#lp-area)" d={`${CHART}L760 214L0 214Z`} />
                      <path className="draw" pathLength={1} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" d={CHART} />
                      <circle className="fade-in" cx={708} cy={60} r={5} strokeWidth={2} style={{ fill: "var(--red)", stroke: "var(--bg)" }} />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
            <div className="g g-solid float lp-float lp-float-a" aria-hidden="true">
              <span className="icon-tile lp-ok-tile"><LIcon name="chat" /></span>
              <span className="lp-col4">
                <b>{t("hero.f1a")}</b>
                <span className="muted lp-small">{t.rich("hero.f1b", rich)}</span>
              </span>
            </div>
            <div className="g g-solid float b lp-float lp-float-b" aria-hidden="true">
              <span className="lp-row-between">
                <bdi dir="ltr" className="mono lp-small">{SHIPPED_ID}</bdi>
                <span className="chip info">{t("hero.f2chip")}</span>
              </span>
              <span className="lp-f2">
                {t("hero.f2a")}<b className="num lp-gap"><bdi>{money("1,800")}</bdi></b><span className="faint">{t.rich("hero.f2b", rich)}</span>
              </span>
            </div>
            <div className="g g-solid float c lp-float lp-float-c" aria-hidden="true">
              <span className="live red" />
              <span className="lp-f3">{t.rich("hero.f3", rich)}</span>
            </div>
          </div>
        </section>

        {/* ───── Integrations ───── */}
        <section className="wrap lp-integrations" aria-labelledby="lp-int">
          <h2 className="eyebrow lp-int-h" id="lp-int">{t("integrations.label")}</h2>
          <ul className="lp-tags">
            {LIVE.map((n) => <li key={n} className="tag lp-int live-tag"><span className="live" aria-hidden="true" /><bdi>{n}</bdi><span className="mz-sr">{t("integrations.live")}</span></li>)}
            {SOON.map((n) => <li key={n} className="tag lp-int soon-tag"><bdi>{n}</bdi><span className="mz-sr">{t("integrations.soon")}</span></li>)}
          </ul>
          <span className="faint lp-small">{t("integrations.note")}</span>
        </section>

        {/* ───── The leak ───── */}
        <section className="sec" id="leak" aria-labelledby="lp-leak">
          <div className="wrap">
            <SectionHead id="lp-leak" eyebrow={t("leak.eyebrow")} title={t("leak.title")} lead={t("leak.lead")} />
            <div className="grid">
              {LEAKS.map(([k, icon]) => (
                <article key={k} className="g card spot reveal">
                  <span className="icon-tile lp-tile-44 lp-red"><LIcon name={icon} size={20} /></span>
                  <h3>{t(`leak.${k}.title`)}</h3>
                  <p>{t(`leak.${k}.body`)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ───── How it works ───── */}
        <section className="sec lp-how" id="how" aria-labelledby="lp-how">
          <div className="wrap">
            <SectionHead id="lp-how" center eyebrow={t("how.eyebrow")} title={t("how.title")} />
            <div className="lp-steps-wrap">
              <div className="step-line" aria-hidden="true" />
              <ol className="lp-steps">
                {STEPS.map(([k, icon], i) => (
                  <li key={k} className="reveal">
                    <span className="g lp-step-icon"><LIcon name={icon} size={24} /></span>
                    <span className="mono faint lp-small">{String(i + 1).padStart(2, "0")}</span>
                    <h3>{t(`how.${k}.title`)}</h3>
                    <p className="muted">{t(`how.${k}.body`)}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ───── Every payment method ───── */}
        <section className="sec" id="payments" aria-labelledby="lp-pay">
          <div className="wrap">
            <SectionHead id="lp-pay" eyebrow={t("payments.eyebrow")} title={t("payments.title")} lead={t("payments.lead")} />
            <div className="grid lp-grid-300">
              {METHODS.map(([k, icon]) => (
                <article key={k} className="g card spot reveal lp-method">
                  <span className="icon-tile lp-tile-48"><LIcon name={icon} size={22} /></span>
                  <span className="lp-col8">
                    <h3>{t(`payments.${k}.title`)}</h3>
                    <p>{t(`payments.${k}.body`)}</p>
                  </span>
                </article>
              ))}
            </div>
            <div className="g reveal lp-rule">
              <span className="icon-tile lp-tile-44 lp-red"><LIcon name="lock" size={20} /></span>
              <strong className="lp-rule-title">{t("payments.rule")}</strong>
              <span className="muted lp-rule-sub">{t("payments.ruleSub")}</span>
            </div>
          </div>
        </section>

        {/* ───── Automation Studio ───── */}
        <section className="sec" id="automations" aria-labelledby="lp-auto">
          <div className="wrap lp-split">
            <div className="reveal lp-split-text">
              <span className="eyebrow">{t("automations.eyebrow")}</span>
              <h2 className="h2 disp" id="lp-auto">{t("automations.title")}</h2>
              <p className="lead">{t("automations.lead")}</p>
              <ul className="lp-recipes">
                {RECIPES.map((k) => <li key={k} className="tag lp-recipe">{t(`automations.recipes.${k}`)}</li>)}
              </ul>
            </div>
            <div className="g reveal lp-recipe-card">
              <div className="lp-row-between lp-recipe-head">
                <span className="eyebrow">{t("automations.recipe")}</span>
                <span className="muted lp-running"><span className="live" aria-hidden="true" />{t("automations.running")}</span>
              </div>
              <ol className="lp-flow">
                {FLOW.map(([k, icon, code], i) => (
                  <li key={k}>
                    <div className={`g-2 lp-flow-step ${i === 2 ? "is-red" : ""}`}>
                      <span className="icon-tile lp-tile-40"><LIcon name={icon} /></span>
                      <span className="lp-col4 lp-grow">
                        <span className="eyebrow lp-flow-kind">{t(`automations.flow.${k}.kind`)}</span>
                        <span className="lp-flow-title">{t(`automations.flow.${k}.title`)}</span>
                      </span>
                      <span className="mono faint lp-code">{code}</span>
                    </div>
                    {i < FLOW.length - 1 ? (
                      <svg className="lp-flow-line" viewBox="0 0 20 28" aria-hidden="true"><path className="flow" d="M10 0V28" strokeWidth={1.5} /></svg>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ───── 22 modules ───── */}
        <section className="sec" id="product" aria-labelledby="lp-mod">
          <div className="wrap">
            <div className="sec-head center reveal">
              <span className="eyebrow">{t("modules.eyebrow")}</span>
              <h2 className="h2 disp" id="lp-mod">{t("modules.title")}</h2>
              <ul className="lp-domains">
                {DOMAINS.map((k) => <li key={k} className="chip plain lp-domain">{t(`modules.domains.${k}`)}</li>)}
              </ul>
            </div>
            <div className="lp-modules">
              <article className="g card spot hero-tile reveal lp-profit">
                <span className="halo" aria-hidden="true" />
                <div className="lp-col14">
                  <span className="eyebrow">{t("modules.profit.kicker")}</span>
                  <h3 className="lp-profit-title">{t("modules.profit.title")}</h3>
                  <p>{t("modules.profit.body")}</p>
                </div>
                <dl className="g-2 lp-pnl">
                  {PNL.map(([k, v]) => (
                    <div key={k}><dt className="muted">{t(`modules.profit.${k}`)}</dt><dd><bdi className="num">{v}</bdi></dd></div>
                  ))}
                  <div className="lp-pnl-net"><dt>{t("modules.profit.net")}</dt><dd><bdi className="num">{money("512")}</bdi></dd></div>
                </dl>
              </article>
              {MODULES.map(([k, icon]) => (
                <article key={k} className="g card spot reveal">
                  <span className="icon-tile lp-tile-44"><LIcon name={icon} size={20} /></span>
                  <h3>{t(`modules.${k}.title`)}</h3>
                  <p>{t(`modules.${k}.body`)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ───── Arabic first ───── */}
        <section className="sec" aria-labelledby="lp-ar">
          <div className="wrap lp-split lp-split-56">
            <div className="reveal lp-split-text">
              <span className="eyebrow">{t("arabic.eyebrow")}</span>
              <h2 className="h2 disp" id="lp-ar">{t("arabic.title")}</h2>
              <p className="lead">{t("arabic.lead")}</p>
              <ul className="lp-points">
                {POINTS.map((k) => <li key={k}><LIcon name="checkCircle" className="lp-ok" />{t(`arabic.${k}`)}</li>)}
              </ul>
            </div>
            <div className="reveal lp-chat-wrap">
              {/* Always Arabic and right to left: it is the message the store's customers receive. */}
              <figure className="g g-lift lp-chat" dir="rtl" lang="ar" aria-label={t("arabic.chatLabel")}>
                <figcaption className="lp-chat-head">
                  <span className="icon-tile lp-chat-avatar"><LIcon name="chat" /></span>
                  <span className="lp-col2">
                    <b>{t("arabic.chat.name")}</b>
                    <span className="faint lp-xs">{t("arabic.chat.sub")}</span>
                  </span>
                </figcaption>
                <div className="g-2 bubble lp-in">{t.rich("arabic.chat.hello", rich)}</div>
                <div className="lp-quick">
                  <span className="tag lp-quick-btn">{t("arabic.chat.confirm")}</span>
                  <span className="tag lp-quick-btn">{t("arabic.chat.edit")}</span>
                </div>
                <div className="bubble lp-out">{t("arabic.chat.confirm")}</div>
                <div className="g-2 bubble lp-in">{t.rich("arabic.chat.done", rich)}</div>
                <span className="chip ok lp-chat-status">{t("arabic.chat.status")}</span>
              </figure>
            </div>
          </div>
        </section>

        {/* ───── Fewer tools ───── */}
        <section className="sec lp-tools-sec" aria-labelledby="lp-tools">
          <div className="wrap">
            <div className="g reveal lp-tools">
              <div className="lp-tools-text">
                <span className="eyebrow">{t("tools.eyebrow")}</span>
                <h2 className="h2 disp" id="lp-tools">{t("tools.title")}</h2>
                <p className="lead">{t("tools.lead")}</p>
              </div>
              <div className="lp-tools-visual">
                <ul className="lp-tools-list">
                  {TOOLS.map((k) => <li key={k} className="g-2 muted"><s>{t(`tools.${k}`)}</s></li>)}
                </ul>
                <LIcon name="arrow" size={28} flip className="faint lp-tools-arrow" />
                <div className="g hero-tile lp-one">
                  <span className="halo" aria-hidden="true" />
                  <div className="ld-orbit lp-orbit" aria-hidden="true">
                    <span className="ring" />
                    <span className="sat"><i /></span>
                    <span className="core g lp-orbit-core">
                      <svg viewBox="0 0 1060 560" aria-hidden="true">
                        <g transform="translate(-66 548) scale(1 -1)"><path d={MONO_M} style={{ fill: "var(--fg)" }} /></g>
                        <rect x="890" y="404" width="144" height="144" style={{ fill: "var(--red)" }} />
                      </svg>
                    </span>
                  </div>
                  <b className="lp-one-name">{t("tools.one")}</b>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ───── Pricing ───── */}
        <section className="sec" id="pricing" aria-labelledby="lp-price">
          <div className="wrap">
            <SectionHead id="lp-price" center eyebrow={t("pricing.eyebrow")} title={t("pricing.title")} lead={t("pricing.lead")} />
            <PricingToggles />
            <p className="faint lp-price-note">{t("pricing.note")}</p>
          </div>
        </section>

        {/* ───── FAQ ───── */}
        <section className="sec lp-faq-sec" id="faq" aria-labelledby="lp-faq">
          <div className="wrap lp-narrow">
            <SectionHead id="lp-faq" center eyebrow={t("faq.eyebrow")} title={t("faq.title")} />
            <Faq />
          </div>
        </section>

        {/* ───── Final call to action ───── */}
        <section className="sec lp-cta-sec" aria-labelledby="lp-cta">
          <div className="wrap">
            <div className="g hero-tile reveal lp-cta">
              <span className="halo lp-cta-halo" aria-hidden="true" />
              <div className="ld-scale lp-scale" aria-hidden="true">
                <span className="post" /><span className="base" />
                <div className="beam"><div className="pan l"><i /><i /><b /></div><div className="pan r"><i /><i /><b /></div></div>
                <span className="pivot" />
              </div>
              <h2 className="h2 disp lp-cta-title" id="lp-cta">{t("cta.title")}</h2>
              <p className="lead lp-center">{t("cta.lead")}</p>
              <div className="lp-ctas">
                <a className="btn btn-primary btn-lg" href={signUpHref(locale)}>{t("nav.start")}</a>
                <a className="btn btn-glass btn-lg" href={demoHref}>{t("hero.demo")}</a>
              </div>
              <span className="chip warn lp-launch">{t("cta.launch")}</span>
            </div>
          </div>
        </section>
      </main>

      {/* ───── Footer ───── */}
      <footer className="wrap lp-footer">
        <div className="lp-footer-cols">
          <div className="lp-footer-brand">
            <Wordmark locale={locale} alt={t("logoAlt")} />
            <span className="muted">{t("footer.about")}</span>
          </div>
          <nav className="lp-footer-col" aria-labelledby="lp-f-product">
            <span className="eyebrow" id="lp-f-product">{t("footer.product")}</span>
            <a className="muted" href="#how">{t("footer.orders")}</a>
            <a className="muted" href="#payments">{t("footer.payments")}</a>
            <a className="muted" href="#how">{t("footer.shipping")}</a>
            <a className="muted" href="#product">{t("footer.profit")}</a>
            <a className="muted" href="#automations">{t("footer.automations")}</a>
          </nav>
          <nav className="lp-footer-col" aria-labelledby="lp-f-company">
            <span className="eyebrow" id="lp-f-company">{t("footer.company")}</span>
            <a className="muted" href={branditaHref} rel="noopener">{t("footer.brandita")}</a>
            <a className="muted" href={demoHref}>{t("footer.contact")}</a>
            <a className="muted" href={partnersHref}>{t("footer.partners")}</a>
            <a className="muted" href={signInHref(locale)}>{t("footer.signIn")}</a>
          </nav>
          <nav className="lp-footer-col" aria-labelledby="lp-f-legal">
            <span className="eyebrow" id="lp-f-legal">{t("footer.legal")}</span>
            <a className="muted" href={legalHref(locale, "privacy")}>{t("footer.privacy")}</a>
            <a className="muted" href={legalHref(locale, "terms")}>{t("footer.terms")}</a>
            <a className="muted" href={legalHref(locale, "dpa")}>{t("footer.dpa")}</a>
          </nav>
        </div>
        <div className="faint lp-footer-bottom">
          <span>{t("footer.copy", { year: new Date().getFullYear() })}</span>
          <span>{t("footer.made")}</span>
        </div>
      </footer>
    </LandingRoot>
  );
}
