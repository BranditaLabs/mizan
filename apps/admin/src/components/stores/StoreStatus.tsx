import { useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const TONE: Record<string, BadgeTone> = { active: "success", trial: "info", suspended: "danger", deleted: "neutral" };

export function StoreStatus({ status }: { status: string }) {
  const t = useTranslations("stores.status");
  return <Badge tone={TONE[status] ?? "neutral"}>{t(status as "active")}</Badge>;
}
