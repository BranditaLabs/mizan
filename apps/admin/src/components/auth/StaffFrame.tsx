"use client";

import { ScaleMark } from "@mizan/design-system/auth/react";
import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Wordmark } from "@/components/Wordmark";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { chooseTheme, currentTheme, subscribeTheme, type Theme } from "@/lib/theme";

const THEMES: ReadonlyArray<{ value: Theme; icon: IconProps["name"]; key: "themeSystem" | "themeLight" | "themeDark" }> = [
  { value: "system", icon: "device", key: "themeSystem" },
  { value: "light", icon: "theme-light", key: "themeLight" },
  { value: "dark", icon: "theme-dark", key: "themeDark" },
];

/**
 * The staff sign-in's frame, the dashboard's auth frame in its "staff" variant (auth spec §2.16):
 * the Brandita top bar (wordmark with "Back office", language, theme), the card, and an ink stage
 * with the scale, the kicker and the drift only (no map, no ticker). Styled by
 * @mizan/design-system/auth.css. `#sms-verifier` is a direct child, outside the animated steps.
 */
export function StaffFrame({ children }: { children: ReactNode }) {
  const t = useTranslations("auth");
  const locale = useLocale() as Locale;
  const other: Locale = locale === "ar" ? "en" : "ar";
  const router = useRouter();
  const pathname = usePathname();
  return (
    <div className="mz-auth" dir={locale === "ar" ? "rtl" : "ltr"}>
      <a href="#main" className="mz-auth-skip">{t("skip")}</a>
      <header className="mz-auth-bar">
        <div className="mz-auth-bar__in">
          <div className="mz-auth-bar__start"><span className="mz-auth-bar__wordmark"><Wordmark /></span></div>
          <div className="mz-auth-bar__mid"><span className="mz-auth-bar__by">{t("by")}</span></div>
          <div className="mz-auth-bar__end">
            {/* The query is dropped on purpose: only `next` matters here and it is re-read after sign-in. */}
            <a href={`/${other}${pathname}`} lang={other} hrefLang={other} className="mz-auth-navlink"
              onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey) return; e.preventDefault(); router.replace(`${pathname}${window.location.search.includes("next=") ? `?next=${encodeURIComponent(new URLSearchParams(window.location.search).get("next") ?? "/")}` : ""}`, { locale: other }); }}>
              <Icon name="language" size={16} />
              {t("language")}
            </a>
            <ThemeMenu />
          </div>
        </div>
      </header>
      <div className="mz-auth-layout">
        <div className="mz-auth-form">
          <main id="main" className="mz-auth-main" tabIndex={-1}>
            <div className="mz-auth-card">
              <div className="mz-auth-card__surface" aria-hidden="true" />
              <div className="mz-auth-card__body">{children}</div>
            </div>
          </main>
        </div>
        <aside className="mz-auth-stage" data-testid="auth-stage" data-scene="staff" data-variant="staff" aria-label={t("kicker")}>
          <span className="mz-auth-stage__ambient" aria-hidden="true" />
          <div className="mz-auth-stage__content">
            <span className="mz-auth-stage__kicker">{t("kicker")}</span>
            <div className="mz-auth-stage__copy">
              <span className="mz-auth-stage__scale"><ScaleMark size={64} mode="settle" /></span>
              <p className="mz-auth-stage__headline">{t("badge")}</p>
            </div>
          </div>
        </aside>
      </div>
      <div id="sms-verifier" />
      <div id="auth-live" role="status" aria-live="polite" className="au-sr" />
    </div>
  );
}

function ThemeMenu() {
  const t = useTranslations("auth");
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => "system" as Theme);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const current = THEMES.find((x) => x.value === theme) ?? THEMES[0]!;
  return (
    <span ref={box} className="mz-auth-pop">
      <button ref={button} type="button" className="mz-auth-iconbtn" aria-haspopup="menu" aria-expanded={open} aria-label={t("theme")} onClick={() => setOpen((o) => !o)}>
        <Icon name={current.icon} size={18} />
      </button>
      {open ? (
        <div role="menu" aria-label={t("theme")} className="mz-auth-menu" onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } }}>
          {THEMES.map((x) => (
            <button key={x.value} type="button" role="menuitemradio" aria-checked={x.value === theme} className="mz-auth-menu__item"
              onClick={() => { chooseTheme(x.value); setOpen(false); button.current?.focus(); }}>
              <Icon name={x.icon} size={16} />
              {t(x.key)}
              <Icon name="confirm" size={16} className="au-check" />
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
