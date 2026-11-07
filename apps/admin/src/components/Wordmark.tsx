import { Wordmark as DsWordmark, type LogoTone } from "@mizan/design-system/react/motion";
import { useLocale, useTranslations } from "next-intl";

/**
 * The Brand 2.0 wordmark (outlined SVG, the page's script) with the back office label.
 * tone="mono" in the app chrome (the content owns the view's one red); "auto" on sign-in, where the
 * full-colour mark is the view's red.
 */
export function Wordmark({ tone = "mono" }: { tone?: LogoTone }) {
  const t = useTranslations("shell");
  const locale = useLocale();
  return (
    <span className="inline-flex items-center gap-2">
      <DsWordmark locale={locale} alt={t("logoAlt")} tone={tone} height={24} />
      <span className="rounded-sm border border-line px-1.5 text-caption text-text-2">{t("backOffice")}</span>
    </span>
  );
}
