"use client";

import { ThemeMenu as SharedThemeMenu } from "@mizan/design-system/auth/react";
import { Icon } from "@mizan/design-system/icons/react";
import { prefersReducedMotion } from "@mizan/design-system/auth-motion";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
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

/**
 * The theme menu (shared with the back office: @mizan/design-system/auth/react). The page
 * crossfades for 200ms where the browser can.
 */
export function ThemeMenu({ initial }: { initial: Theme }) {
  const t = useTranslations("frame.theme");
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => initial);
  const onPick = (v: Theme) => {
    const doc = document as Document & { startViewTransition?(cb: () => void): unknown };
    if (doc.startViewTransition && !prefersReducedMotion()) doc.startViewTransition(() => chooseTheme(v));
    else chooseTheme(v);
  };
  return <SharedThemeMenu value={theme} onPick={onPick} labels={{ label: t("label"), system: t("system"), light: t("light"), dark: t("dark") }} />;
}
