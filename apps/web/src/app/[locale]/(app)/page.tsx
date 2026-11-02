import { getTranslations, setRequestLocale } from "next-intl/server";
import { HomeWelcome } from "@/components/home/HomeWelcome";
import { ProfitHome } from "@/components/home/ProfitHome";
import { SetupCard } from "@/components/onboarding/SetupCard";
import { StoreName } from "@/components/StoreName";

/**
 * Home (E9-4): what the store really kept, for the people who see profit; until the store has
 * orders (and for agents), the welcome with setup and the empty state.
 */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-6 pb-14 md:px-6">
      <ProfitHome setup={<SetupCard />} fallback={(
        <>
          <StoreName className="text-overline uppercase text-text-3" />
          <h1 className="mt-1 font-display text-heading-lg">{t("title")}</h1>
          <SetupCard />
          <HomeWelcome />
        </>
      )} />
    </div>
  );
}
