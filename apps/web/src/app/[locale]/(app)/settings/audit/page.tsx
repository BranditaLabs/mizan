import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuditLogScreen } from "@/components/settings/AuditLogScreen";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auditLog" });
  return { title: t("title") };
}

/** Settings → Audit log (A-8). */
export default async function AuditLogPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AuditLogScreen />;
}
