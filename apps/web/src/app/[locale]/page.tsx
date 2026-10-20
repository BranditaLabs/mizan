import { getTranslations, setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { Bdi } from "@/components/Bdi";
import { ChevronIcon } from "@/components/DirIcon";
import { Shell } from "@/components/Shell";
import { formatMoney } from "@/lib/format";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

/** Placeholder home for E4-1: proves tokens, both directions and both themes. The real home is E9-4. */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <Shell theme={theme} active="home">
      <div className="mx-auto max-w-[1360px] px-6 pt-7 pb-14">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">{t("eyebrow")}</p>
        <h1 className="mt-1 font-display text-[28px] font-bold leading-tight tracking-tight">{t("title")}</h1>
        <p className="mt-1.5 max-w-[62ch] text-ink-2">{t("subtitle")}</p>

        <section className="mt-6 rounded-card border border-line bg-surface p-6 shadow-card" aria-labelledby="empty-title">
          <h2 id="empty-title" className="text-sm font-semibold">{t("empty.title")}</h2>
          <p className="mt-1 text-ink-2">{t("empty.body", { days: 60 })}</p>
          <p className="mt-3 text-[13px] text-ink-3" data-testid="example">
            {t.rich("example", {
              number: "#1042",
              amount: formatMoney({ amount: "1150.00", currency: "EGP" }, locale),
              num: (chunks) => <Bdi code>{chunks}</Bdi>,
              money: (chunks) => <Bdi>{chunks}</Bdi>,
            })}
          </p>
          <span className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-ink px-3.5 text-[13px] font-semibold text-bg" aria-disabled="true">
            {t("empty.cta")}
            <ChevronIcon />
          </span>
        </section>
      </div>
    </Shell>
  );
}
