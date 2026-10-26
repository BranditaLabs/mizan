import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { TicketDetail } from "@/components/tickets/TicketDetail";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tickets" });
  return { title: t("title") };
}

/** One ticket (E10-1). */
export default async function TicketPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <TicketDetail id={id} />;
}
