import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { TicketsScreen } from "@/components/tickets/TicketsScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tickets" });
  return { title: t("title") };
}

/** M6 tickets (E10-1). */
export default async function TicketsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <TicketsScreen />;
}
