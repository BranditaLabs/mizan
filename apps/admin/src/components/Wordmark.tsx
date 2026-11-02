import { useLocale, useTranslations } from "next-intl";

/** The wordmark (outlined SVG) with the back office label; dark-theme file in dark mode. */
export function Wordmark() {
  const t = useTranslations("shell");
  const ar = useLocale() === "ar";
  const file = (dark: boolean) => `/brand/mizan-wordmark${ar ? "-ar" : ""}${dark ? "-on-dark" : ""}.svg`;
  return (
    <span className="inline-flex items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG */}
      <img src={file(false)} alt={t("logoAlt")} className="h-6 w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG */}
      <img src={file(true)} alt={t("logoAlt")} className="hidden h-6 w-auto dark:block" />
      <span className="rounded-sm border border-line px-1.5 text-caption text-text-2">{t("backOffice")}</span>
    </span>
  );
}
