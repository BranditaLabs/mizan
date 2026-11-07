import { Bilingual as DsBilingual, Lockup as DsLockup, Mark as DsMark, Wordmark as DsWordmark, type LogoTone } from "@mizan/design-system/react/motion";
import { useLocale, useTranslations } from "next-intl";

/**
 * The Brand 2.0 marks (outlined files in public/brand, never live type), in the page's script.
 *   tone="auto"  full colour, the -on-ink file in the dark theme (auth, boot, outage: their one red)
 *   tone="mono"  one colour (the app chrome: the content owns the view's red, D4)
 */
export function ThemedWordmark({ className = "", tone = "auto", height = 24 }: { className?: string; tone?: LogoTone; height?: number }) {
  const t = useTranslations("shell");
  const locale = useLocale();
  return <DsWordmark locale={locale} alt={t("logoAlt")} tone={tone} height={height} className={className} />;
}

/** The two-ball mark: ink left, red right, like scale pans. */
export function BrandMark({ className = "", tone = "auto", height = 24 }: { className?: string; tone?: LogoTone; height?: number }) {
  const t = useTranslations("shell");
  return <DsMark alt={t("logoAlt")} tone={tone} height={height} className={className} />;
}

/**
 * Mark and wordmark together: the pack's lockup in Latin; in Arabic the pack's bilingual file
 * (mizan · ميزان). The pack has no Arabic-only lockup, so none is assembled here.
 */
export function BrandLockup({ className = "", tone = "auto", height = 28 }: { className?: string; tone?: LogoTone; height?: number }) {
  const t = useTranslations("shell");
  const locale = useLocale();
  if (locale.startsWith("ar")) return <DsBilingual alt={t("logoAlt")} tone={tone} height={height} className={className} />;
  return <DsLockup alt={t("logoAlt")} tone={tone} height={height} className={className} />;
}
