import { useLocale, useTranslations } from "next-intl";

/** The wordmark, outlined (never live type). `onDark` for the ink rail and dark surfaces. */
export function Wordmark({ onDark, className = "" }: { onDark: boolean; className?: string }) {
  const t = useTranslations("shell");
  const ar = useLocale() === "ar";
  const file = `mizan-wordmark${ar ? "-ar" : ""}${onDark ? "-on-dark" : ""}.svg`;
  // eslint-disable-next-line @next/next/no-img-element -- static brand SVG, no optimisation needed
  return <img src={`/brand/${file}`} alt={t("logoAlt")} className={`h-6 w-auto ${className}`} />;
}

/** The wordmark for the page background: dark ink in light theme, the on-dark file in dark theme. */
export function ThemedWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={className}>
      <Wordmark onDark={false} className="dark:hidden" />
      <Wordmark onDark className="hidden dark:block" />
    </span>
  );
}
