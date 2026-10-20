import { Icon } from "@mizan/design-system/icons/react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Bdi } from "@/components/Bdi";
import { buttonClass } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { SetupCard } from "@/components/onboarding/SetupCard";
import { StoreName } from "@/components/StoreName";
import { formatMoney } from "@/lib/format";

/** Placeholder home (E4-1/E4-2): the store you are in, both directions and themes. The real home is E9-4. */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-6 pb-14 md:px-6">
      <StoreName className="text-overline uppercase text-text-3" />
      <h1 className="mt-1 font-display text-heading-lg">{t("title")}</h1>
      <p className="mt-1.5 max-w-[62ch] text-body text-text-2">{t("subtitle")}</p>
      <SetupCard />

      {/* Empty state (components.md §6): icon, one-line title, one sentence, one action. */}
      <section className="mt-6 rounded-lg border border-line bg-surface p-6" aria-labelledby="empty-title">
        <Icon name="orders" size={24} className="text-text-3" />
        <h2 id="empty-title" className="mt-3 text-heading-sm">{t("empty.title")}</h2>
        <p className="mt-1 text-body text-text-2">{t("empty.body", { days: 60 })}</p>
        <p className="mt-3 text-body-sm text-text-3" data-testid="example">
          {t.rich("example", {
            number: "#1042",
            amount: formatMoney({ amount: "1150.00", currency: "EGP" }, locale),
            num: (chunks) => <Bdi code>{chunks}</Bdi>,
            money: (chunks) => <Bdi>{chunks}</Bdi>,
          })}
        </p>
        <Link href="/onboarding" className={buttonClass("primary", "md", "mt-4")}>
          {t("empty.cta")}
          <Icon name="forward" size={16} />
        </Link>
      </section>
    </div>
  );
}
