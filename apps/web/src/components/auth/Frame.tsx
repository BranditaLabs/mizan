import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { GlassRoot } from "@/components/GlassRoot";
import { Link } from "@/i18n/navigation";
import { SEEN_SCRIPT } from "@/lib/auth/intent";
import { legalPath } from "@/lib/legal";
import type { Theme } from "@/lib/theme";
import { AuthStage } from "./stage/AuthStage";
import { AuthTopBar, FrameWatch } from "./TopBar";

/**
 * The persistent frame of the screens before a store ((auth)/layout.tsx): "a focus card on a living
 * stage". It stays mounted between sign-in, welcome and two-step, so the top bar, the stage, the
 * card's surface, the live region and the reCAPTCHA container never remount; only the card's
 * content changes. DOM order is the reading order: skip link, bar, the form (main), the stage, the
 * footer. `#sms-verifier` is a direct child, outside every animated subtree (security invariant S4).
 */
export function AuthShell({ theme, wide = false, children }: { theme: Theme; wide?: boolean; children: ReactNode }) {
  const t = useTranslations("frame");
  const ta = useTranslations("auth");
  return (
    <GlassRoot theme={theme} fields={false} className="mz-auth">
      {/* A repeat visit within 10 minutes (a language switch included) gets a 150ms fade, no rise. */}
      <script dangerouslySetInnerHTML={{ __html: SEEN_SCRIPT }} />
      <a href="#main" className="mz-auth-skip">{t("skip")}</a>
      <AuthTopBar theme={theme} />
      <div className="mz-auth-layout">
        <div className="mz-auth-form">
          <main id="main" className="mz-auth-main" data-wide={wide ? "" : undefined} tabIndex={-1}>
            <div className="mz-auth-card">
              <div className="mz-auth-card__surface" aria-hidden="true" />
              <div className="mz-auth-card__body">{children}</div>
            </div>
          </main>
          <footer className="mz-auth-foot">
            <span>{ta("footer.rights")}</span>
            <nav aria-label={ta("footer.legal")}>
              {(["privacy", "terms", "dpa"] as const).map((d) => <Link key={d} href={legalPath(d)}>{ta(`footer.${d}`)}</Link>)}
            </nav>
          </footer>
        </div>
        <AuthStage />
      </div>
      <div id="sms-verifier" />
      <div id="auth-live" role="status" aria-live="polite" className="au-sr" />
      <FrameWatch />
    </GlassRoot>
  );
}
