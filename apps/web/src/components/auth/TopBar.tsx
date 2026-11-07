"use client";

import { prefersReducedMotion } from "@mizan/design-system/auth-motion";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { AuthWordmark } from "@/components/AuthWordmark";
import { Link, usePathname } from "@/i18n/navigation";
import { authUi, useAuthUi } from "@/lib/auth/ui-store";
import { LanguageLink, ThemeMenu } from "./Toggles";

const SUPPORT = process.env.NEXT_PUBLIC_SUPPORT_URL ?? "";

/**
 * The Brandita top bar of the screens before a store: a floating pill, clear at the top and glass
 * after 8px of scroll. Start: the wordmark (a link home). End: language, theme, and from tablets
 * up "Need help?" and the opposite of the card's mode. On landscape phones it is static and hides
 * while scrolling down (shows after 6px up), never under reduced motion.
 */
export function AuthTopBar() {
  const t = useTranslations("frame");
  const pathname = usePathname();
  const { mode } = useAuthUi();
  const [glass, setGlass] = useState(false);
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);

  useEffect(() => {
    let frame = 0;
    const short = window.matchMedia("(max-height: 500px) and (orientation: landscape)");
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = window.scrollY;
        setGlass(y > 8);
        if (short.matches && !prefersReducedMotion()) {
          if (y > last.current + 36) { setHidden(true); last.current = y; } else if (y < last.current - 6) { setHidden(false); last.current = y; }
        } else setHidden(false);
        if (!short.matches) last.current = y;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); };
  }, []);

  const onSignIn = pathname === "/sign-in";
  return (
    <header className="mz-auth-bar" data-glass={glass ? "" : undefined} data-hidden={hidden ? "" : undefined}>
      <div className="mz-auth-bar__in">
        <div className="mz-auth-bar__start">
          <Link href="/" className="mz-auth-bar__wordmark" aria-label={t("home")}><AuthWordmark staged /></Link>
        </div>
        <div className="mz-auth-bar__mid"><span className="mz-auth-bar__by">{t("by")}</span></div>
        <div className="mz-auth-bar__end">
          {SUPPORT ? <a href={SUPPORT} className="mz-auth-navlink au-wide" rel="noopener">{t("help")}</a> : null}
          {onSignIn ? (
            // A link (not a button) so it never shares a name with the card's own "Create an account" button.
            <Link href={mode === "create" ? "/sign-in" : "/sign-in?mode=signup"} className="mz-auth-navlink au-wide"
              onClick={(e) => { e.preventDefault(); authUi.requestMode(mode === "create" ? "signin" : "create"); }}>
              {/* The full question from 1024px; the short form on tablets, where the bar is narrower (one shows at a time). */}
              <span className="au-long">{mode === "create" ? t("haveQLink") : t("newQLink")}</span>
              <span className="au-short">{mode === "create" ? t("haveQLinkShort") : t("newQLinkShort")}</span>
            </Link>
          ) : null}
          <LanguageLink />
          <ThemeMenu />
        </div>
      </div>
    </header>
  );
}

/**
 * Watches the on-screen keyboard (visualViewport under 75% of the window) and the network, for the
 * frame: the phone strip hides and the stage's loops pause while typing; offline is a banner.
 */
export function FrameWatch() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.querySelector<HTMLElement>(".mz-auth");
    const check = () => {
      const open = Boolean(vv && vv.height < window.innerHeight * 0.75 && window.matchMedia("(pointer: coarse)").matches);
      authUi.set({ keyboard: open });
      if (root) { if (open) root.setAttribute("data-keyboard", ""); else root.removeAttribute("data-keyboard"); }
    };
    // A field covered by the keyboard scrolls into view.
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.matches?.("input, select, textarea") || !vv) return;
      window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        if (r.bottom > vv.height - 8) el.scrollIntoView({ block: "center" });
      }, 50);
    };
    vv?.addEventListener("resize", check);
    document.addEventListener("focusin", onFocus);
    return () => { vv?.removeEventListener("resize", check); document.removeEventListener("focusin", onFocus); };
  }, []);
  return null;
}
