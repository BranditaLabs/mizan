"use client";

import { ThemeMenu as SharedThemeMenu } from "@mizan/design-system/auth/react";
import { Icon } from "@mizan/design-system/icons/react";
import { FluidMark, useRedTaken, useStageHidden } from "@mizan/design-system/react/motion";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Wordmark } from "@/components/Wordmark";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { staffStage } from "@/lib/auth-stage";
import { chooseTheme, currentTheme, subscribeTheme, type Theme } from "@/lib/theme";

/**
 * The staff sign-in's frame, the dashboard's auth frame in its "staff" variant (auth spec §2.16):
 * the Brandita top bar (wordmark with "Back office", language, theme), the card, and an ink stage
 * with the Brand 2.0 mark (it arrives once, then stays still and tips on an error, as on the
 * dashboard's stage; its red ball is the view's one red, so the wordmark is mono), the kicker and
 * one word (no map, no ticker). Styled by
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
          <div className="mz-auth-bar__start"><span className="mz-auth-bar__wordmark"><StaffWordmark /></span></div>
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
              <span className="mz-auth-stage__mark"><StageMark /></span>
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

/** The shared theme menu (@mizan/design-system/auth/react) with the staff app's words. */
function ThemeMenu() {
  const t = useTranslations("auth");
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => "system" as Theme);
  return <SharedThemeMenu value={theme} onPick={chooseTheme} labels={{ label: t("theme"), system: t("themeSystem"), light: t("themeLight"), dark: t("themeDark") }} />;
}

/**
 * The staff sign-in's wordmark: mono while something holds the red (the stage's mark, DoneState's
 * DROP when signed in). It starts mono on the server, as the mark claims right after hydration (the
 * red never hops from the wordmark to the mark); full colour where the stage is hidden.
 */
function StaffWordmark() {
  const taken = useRedTaken(true);
  return <Wordmark tone={taken ? "mono" : "auto"} />;
}

/** The beats' lengths (the dashboard stage's machine: settle with the intro, tip 2600). */
const BEAT_MS = { settle: 1200, tip: 2600 } as const;

/**
 * The stage's mark: it arrives once (SETTLE), then stays still; an error on the card tips it (TIP,
 * then level). Signed in, it lets the red go to the card's DROP. Hidden by the screen's shape (a
 * landscape phone), it claims no red. Reduced motion shows it still (FluidMark).
 */
function StageMark() {
  const [beat, setBeat] = useState<{ kind: "settle" | "tip" | null; key: number }>({ kind: "settle", key: 0 });
  const [signedIn, setSignedIn] = useState(false);
  const hidden = useStageHidden();
  useEffect(() => staffStage.onSignal((s) => {
    if (s === "signedIn") setSignedIn(true);
    else setBeat((b) => ({ kind: "tip", key: b.key + 1 }));
  }), []);
  useEffect(() => {
    if (!beat.kind) return;
    const id = window.setTimeout(() => setBeat((b) => ({ ...b, kind: null })), BEAT_MS[beat.kind]);
    return () => window.clearTimeout(id);
  }, [beat.kind, beat.key]);
  return <FluidMark beat={signedIn ? null : beat.kind} beatKey={beat.key} claim={!hidden && !signedIn} size={96} />;
}
