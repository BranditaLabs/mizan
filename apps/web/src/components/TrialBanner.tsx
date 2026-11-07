"use client";

import { rolesWith } from "@mizan/shared";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const READERS = rolesWith("billing.read");

/** The store's subscription (E12-2a3), shared by the banner and Settings → Plan and usage. */
export function useSubscription() {
  const { api, user, store } = useSession();
  const allowed = READERS.has(store?.role ?? "");
  return useQuery({
    queryKey: ["subscription", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/billing/subscription")),
    enabled: Boolean(store) && allowed,
    staleTime: 5 * 60_000,
    meta: { toast: false },
  });
}

/**
 * The trial in the dashboard (E12-2a3): one line with the days left, counted in the store's time
 * zone, and what happens after (Free; orders keep coming in). Hidden for the day when dismissed,
 * except on the last day. Owner, admin and finance.
 */
export function TrialBanner() {
  const t = useTranslations("trial");
  const tp = useTranslations("planBanner");
  const { store } = useSession();
  const q = useSubscription();
  const trial = q.data?.trial;
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!store || !trial) return null;
  const last = trial.daysLeft <= 1;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: q.data!.timezone }).format(new Date());
  const k = `mizan-trial-banner:${store.tenantId}:${today}`;
  let stored = false;
  try { stored = !last && localStorage.getItem(k) === "1"; } catch { /* storage blocked: show it */ }
  if (stored || (!last && dismissed === k)) return null;
  const hide = () => {
    try { localStorage.setItem(k, "1"); } catch { /* private window: hide for now only */ }
    setDismissed(k);
  };
  const n = (c: ReactNode) => <bdi dir="ltr" className="mz-num font-medium">{c}</bdi>;
  return (
    <div role="status" data-testid="trial-banner"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-body-sm md:px-6 ${last ? "border-warning bg-warning-soft text-warning-text" : "border-info bg-info-soft text-info-text"}`}>
      <span>{t.rich(last ? "lastDay" : "daysLeft", { days: trial.daysLeft, plan: tp(`plan.${trial.plan}`), n })}</span>
      <Link href="/settings/usage" className="font-medium underline">{tp("see")}</Link>
      {last ? null : <button type="button" className="ms-auto underline" onClick={hide}>{tp("hide")}</button>}
    </div>
  );
}
