"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState, useSyncExternalStore, useTransition, type PointerEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { chooseTheme, currentTheme, subscribeTheme } from "@/lib/theme";
import { LIcon } from "./icons";
import { demoHref, signUpHref } from "./links";
import { formatPrice, monthlyPrice, PLANS } from "./pricing";

/* ───────────── Theme: dark like the board, unless the person chose light ───────────── */
const choseLight = () => currentTheme() === "light";
/** The page is prerendered dark; the browser switches to light when the person chose it (cookie, lib/theme). */
function useLight() {
  return useSyncExternalStore(subscribeTheme, choseLight, () => false);
}


/** Light under the pointer on the glass cards (.spot, glass.css): one listener for the whole page. */
function spotlight(e: PointerEvent<HTMLDivElement>) {
  if (e.pointerType !== "mouse") return;
  const card = (e.target as Element).closest?.<HTMLElement>(".spot");
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${e.clientX - r.left}px`);
  card.style.setProperty("--my", `${e.clientY - r.top}px`);
}

/**
 * The Mizan Glass root of the landing page (glass.css `.mzg`): dark by default as on the board, light
 * when the person chose it (the same `mizan-theme` cookie as the app), the reading direction of the
 * locale, and the light fields drifting behind the glass.
 */
export function LandingRoot({ children }: { children: ReactNode }) {
  const dir = useLocale() === "ar" ? "rtl" : "ltr";
  const light = useLight();
  return (
    // suppressHydrationWarning: NO_FLASH may already have added "light" before React hydrates.
    <div className={`mzg landing ${light ? "light" : ""}`} dir={dir} onPointerMove={spotlight} suppressHydrationWarning>
      <div className="fields" aria-hidden="true"><i className="f1" /><i className="f2" /><i className="f3" /><div className="dots" /></div>
      {children}
    </div>
  );
}

/** Light or dark in one press, remembered for the app too. */
export function ThemeButton() {
  const t = useTranslations("landing.nav");
  const light = useLight();
  return (
    <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t("theme")} aria-pressed={light}
      onClick={() => chooseTheme(light ? "dark" : "light")}>
      <LIcon name="moon" />
    </button>
  );
}

/** The same page in the other language ("عربي" on the English page, "English" on the Arabic one). */
export function LanguageButton() {
  const t = useTranslations("landing.nav");
  const locale = useLocale() as Locale;
  const other: Locale = locale === "ar" ? "en" : "ar";
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  return (
    // The accessible name starts with the visible word ("English", WCAG 2.5.3), spoken in its own language.
    <button type="button" className="btn btn-ghost btn-sm" aria-busy={pending || undefined}
      onClick={() => startTransition(() => router.replace(pathname, { locale: other, scroll: false }))}>
      <LIcon name="language" />
      <span className="lp-hide-xs" lang={other}>{t("lang")}</span>{" "}
      <span className="mz-sr">{t("langLabel")}</span>
    </button>
  );
}

/* ───────────── Pricing: monthly / annual, Egypt / GCC ───────────── */
const SEG_W = 104;

function Seg({ label, value, options, onChange }: {
  label: string; value: boolean; options: [string, string]; onChange: (v: boolean) => void;
}) {
  const flip = useLocale() === "ar" ? -1 : 1;
  return (
    <div className="seg lp-seg" role="group" aria-label={label}>
      <span className="seg-thumb" aria-hidden="true" style={{ width: SEG_W, transform: `translateX(${(value ? SEG_W : 0) * flip}px)` }} />
      {options.map((o, i) => (
        <button key={o} type="button" aria-pressed={value === (i === 1)} style={{ width: SEG_W, padding: 0 }} onClick={() => onChange(i === 1)}>{o}</button>
      ))}
    </div>
  );
}

export function PricingToggles() {
  const t = useTranslations("landing.pricing");
  const locale = useLocale();
  const [annual, setAnnual] = useState(false);
  const [gcc, setGcc] = useState(false);
  const unit = t(gcc ? (annual ? "unitGccAnnual" : "unitGccMonthly") : (annual ? "unitEgAnnual" : "unitEgMonthly"));
  const growthPlan = PLANS.find((p) => p.id === "growth")!;
  const growth = formatPrice(monthlyPrice((gcc ? growthPlan.usd : growthPlan.egp)!, annual), gcc);
  return (
    <>
      <div className="lp-toggles">
        <Seg label={t("billing")} value={annual} options={[t("monthly"), t("annual")]} onChange={setAnnual} />
        <Seg label={t("region")} value={gcc} options={[t("egypt"), t("gcc")]} onChange={setGcc} />
      </div>
      {/* One short line for screen readers when a toggle changes the prices, not the four cards again. */}
      <p className="mz-sr" aria-live="polite">
        {t("announce", { billing: t(annual ? "annual" : "monthly"), region: t(gcc ? "gcc" : "egypt"), plan: t("growth.name"), price: growth, unit })}
      </p>
      <div className={`lp-plans ${annual ? "lp-annual" : ""}`}>
        {PLANS.map((p) => {
          const featured = p.id === "growth";
          const base = gcc ? p.usd : p.egp;
          const price = base === undefined ? null : formatPrice(monthlyPrice(base, annual), gcc);
          const cta = p.id === "free" ? t("start") : p.id === "enterprise" ? t("talk") : t("trial");
          const href = p.id === "enterprise" ? demoHref : signUpHref(locale);
          return (
            <article key={p.id} className={`g lp-plan ${featured ? "hero-tile g-lift" : ""}`}>
              {featured ? <span className="halo" aria-hidden="true" /> : null}
              <div className="lp-plan-head">
                <h3>{t(`${p.id}.name`)}</h3>
                {featured ? <span className="chip plain lp-recommended">{t("recommended")}</span> : null}
              </div>
              <div className="lp-price-row">
                {price === null ? <span className="price">{t("custom")}</span> : (
                  <>
                    <bdi className="price num">{price}</bdi>
                    <span className="faint lp-unit">{unit}</span>
                  </>
                )}
              </div>
              <span className="muted lp-plan-orders">{t(`${p.id}.orders`)}</span>
              <a className={`btn btn-lg lp-block ${featured ? "btn-primary" : "btn-glass"}`} href={href}>{cta}</a>
              <ul className="plan">
                {Array.from({ length: p.features }, (_, i) => (
                  <li key={i}><LIcon name="check" size={16} />{t(`${p.id}.f${i + 1}`)}</li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </>
  );
}

/* ───────────── FAQ: one answer open at a time, the first one to start ───────────── */
const FAQ = ["cod", "store", "couriers", "cut", "data", "team"] as const;

export function Faq() {
  const t = useTranslations("landing.faq");
  const [open, setOpen] = useState(0);
  const id = useId();
  return (
    <div className="lp-faq">
      {FAQ.map((k, i) => {
        const isOpen = open === i;
        return (
          <div key={k} className="g lp-faq-item">
            <h3 className="lp-faq-h">
              <button className="faq-q" type="button" id={`${id}-q${i}`} aria-expanded={isOpen} aria-controls={`${id}-a${i}`}
                onClick={() => setOpen(isOpen ? -1 : i)}>
                {t(`${k}.q`)}
                <LIcon name="plus" />
              </button>
            </h3>
            <div id={`${id}-a${i}`} role="region" aria-labelledby={`${id}-q${i}`} hidden={!isOpen}>
              <p className="muted slide-in lp-faq-a">{t(`${k}.a`)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
