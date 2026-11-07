"use client";

import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { prefersReducedMotion } from "@mizan/design-system/auth-motion";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from "react";
import { getPathname, usePathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { carriedQuery } from "@/lib/auth/params";
import { useAuthUi } from "@/lib/auth/ui-store";
import { chooseTheme, currentTheme, subscribeTheme, type Theme } from "@/lib/theme";

/**
 * The other language as a real link (lang, hrefLang) to the same page, carrying only the
 * allow-listed query (next, mode, plan, billing, reason, enrolled, invite: re-serialised, never
 * copied raw). While a code is being typed it asks first: switching means asking for a new code.
 */
export function LanguageLink() {
  const t = useTranslations("frame");
  const tl = useTranslations("shell.language");
  const locale = useLocale() as Locale;
  const other: Locale = locale === "ar" ? "en" : "ar";
  const pathname = usePathname();
  const router = useRouter();
  const { locked } = useAuthUi();
  const [asking, setAsking] = useState(false);
  const stay = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (asking) stay.current?.focus(); }, [asking]);
  // The href is the page itself (a real link: lang, hrefLang, open in a new tab); a click adds the
  // allow-listed query, read from the address bar at that moment.
  const href = getPathname({ href: pathname, locale: other });
  const go = () => {
    setAsking(false);
    router.replace(`${pathname}${carriedQuery(window.location.search)}`, { locale: other });
  };
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (locked) setAsking(true);
    else go();
  };
  return (
    <span className="mz-auth-pop">
      <a href={href} lang={other} hrefLang={other} className="mz-auth-navlink" onClick={onClick} aria-haspopup={locked ? "dialog" : undefined} aria-expanded={locked ? asking : undefined}>
        <Icon name="language" size={16} />
        {tl(other)}
      </a>
      {asking ? (
        <div className="mz-auth-menu mz-auth-confirm" role="dialog" aria-modal="false" aria-labelledby="lang-confirm-title"
          onKeyDown={(e) => { if (e.key === "Escape") setAsking(false); }}>
          <strong id="lang-confirm-title">{t("langSwitchTitle")}</strong>
          <p>{t("langSwitchBody")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="mz-auth-btn" onClick={go} lang={other}>{t("langSwitchGo")}</button>
            <button ref={stay} type="button" className="mz-auth-btn mz-auth-btn--ghost" onClick={() => setAsking(false)}>{t("langSwitchStay")}</button>
          </div>
        </div>
      ) : null}
    </span>
  );
}

const THEMES: ReadonlyArray<{ value: Theme; icon: IconProps["name"] }> = [
  { value: "system", icon: "device" },
  { value: "light", icon: "theme-light" },
  { value: "dark", icon: "theme-dark" },
];

/**
 * The theme as a menu: Same as device, Light, Dark (menuitemradio, aria-checked). The button's
 * icon shows the theme in force. The page crossfades for 200ms where the browser can.
 */
export function ThemeMenu({ initial }: { initial: Theme }) {
  const t = useTranslations("frame.theme");
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => initial);
  const [open, setOpen] = useState(false);
  const [turn, setTurn] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const box = useRef<HTMLSpanElement>(null);
  const current = THEMES.find((x) => x.value === theme) ?? THEMES[0]!;

  useEffect(() => {
    if (!open) return;
    items.current[THEMES.findIndex((x) => x.value === theme)]?.focus();
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (v: Theme) => {
    setOpen(false);
    button.current?.focus();
    if (v === theme) return;
    setTurn((n) => n + 1);
    const doc = document as Document & { startViewTransition?(cb: () => void): unknown };
    if (doc.startViewTransition && !prefersReducedMotion()) doc.startViewTransition(() => chooseTheme(v));
    else chooseTheme(v);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.current.findIndex((el) => el === document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); button.current?.focus(); return; }
    if (e.key === "Tab") { setOpen(false); return; }
    const n = THEMES.length;
    const to = e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowUp" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (to === null) return;
    e.preventDefault();
    items.current[to]?.focus();
  };
  return (
    <span ref={box} className="mz-auth-pop">
      <button ref={button} type="button" className="mz-auth-iconbtn" aria-haspopup="menu" aria-expanded={open} aria-label={t("label")}
        data-turn={turn ? "" : undefined} key={`b-${turn}`} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); } }}>
        <Icon name={current.icon} size={18} />
      </button>
      {open ? (
        <div role="menu" aria-label={t("label")} className="mz-auth-menu" onKeyDown={onKey}>
          {THEMES.map((x, i) => (
            <button key={x.value} ref={(el) => { items.current[i] = el; }} type="button" role="menuitemradio" aria-checked={x.value === theme}
              tabIndex={x.value === theme ? 0 : -1} className="mz-auth-menu__item" onClick={() => pick(x.value)}>
              <Icon name={x.icon} size={16} />
              {t(x.value)}
              <Icon name="confirm" size={16} className="au-check" />
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
