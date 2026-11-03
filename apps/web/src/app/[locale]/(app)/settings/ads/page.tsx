import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

type Props = { params: Promise<{ locale: string }> };

/** Ad spend moved under Profit (U4); old links and bookmarks still land there. */
export default async function OldAdSpendPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirect({ href: "/profit/spend", locale });
}
