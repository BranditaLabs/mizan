"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const READERS = new Set(["owner", "admin", "finance"]);
const key = (tenantId: string, level: string) => `mizan-plan-banner:${tenantId}:${level}`;

/**
 * The plan's soft limits (E12-1): when this month is near a limit or past it, one line across the
 * dashboard for owner, admin and finance, with a link to Plan and usage. Nothing is blocked. It
 * can be hidden for this visit; going from near to over shows it again.
 */
export function PlanBanner() {
  const t = useTranslations("planBanner");
  const { api, user, store } = useSession();
  const allowed = READERS.has(store?.role ?? "");
  const q = useQuery({
    queryKey: ["usage", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/usage")),
    enabled: Boolean(store) && allowed,
    staleTime: 5 * 60_000,
    meta: { toast: false },
  });
  const alerts = q.data?.alerts ?? [];
  const worst = alerts.find((a) => a.level === "over") ?? alerts[0];
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!allowed || !worst || !store) return null;
  // Read here, not in an effect: the banner only shows once the usage has loaded, in the browser.
  const k = key(store.tenantId, worst.level);
  let stored = false;
  try { stored = sessionStorage.getItem(k) === "1"; } catch { /* storage blocked: show it */ }
  if (stored || dismissed === k) return null;
  const hide = () => {
    try { sessionStorage.setItem(k, "1"); } catch { /* private window: hide for now only */ }
    setDismissed(k);
  };
  return (
    <div role="status" data-testid="plan-banner"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-body-sm md:px-6 ${worst.level === "over" ? "border-danger bg-danger-soft text-danger-text" : "border-warning bg-warning-soft text-warning-text"}`}>
      <span>{t.rich(`${worst.metric}.${worst.level}`, { used: worst.used, limit: worst.limit, plan: t(`plan.${q.data!.plan}`), n: (c) => <bdi dir="ltr" className="mz-num font-medium">{c}</bdi> })}</span>
      <Link href="/settings/usage" className="font-medium underline">{t("see")}</Link>
      <button type="button" className="ms-auto underline" onClick={hide}>{t("hide")}</button>
    </div>
  );
}
