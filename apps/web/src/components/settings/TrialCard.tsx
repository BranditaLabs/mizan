"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { DateText } from "@/components/ui/Values";
import { useSubscription } from "@/components/TrialBanner";

/**
 * Settings → Plan and usage: the subscription (E12-2a3). A running trial with its days left and
 * its last day (in the store's time zone), what happens after; or that the trial is over and the
 * store is on Free, orders still coming in. Payment comes with E12-2b0.
 */
export function TrialCard() {
  const t = useTranslations("trial");
  const tp = useTranslations("planBanner");
  const q = useSubscription();
  const s = q.data;
  if (!s) return null;
  const n = (c: ReactNode) => <bdi dir="ltr" className="mz-num font-medium">{c}</bdi>;
  const status = <Badge tone={s.trial ? "info" : s.status === "active" ? "success" : "warning"} dot={false}>{t(`status.${s.status}`)}</Badge>;
  return (
    <section className="mz-card flex flex-col gap-2 p-5" data-testid="subscription">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-heading-sm">{t("title", { plan: tp(`plan.${s.plan}`) })}</h2>
        {status}
      </div>
      {s.trial ? (
        <>
          <p className="text-body-sm">{t.rich(s.trial.daysLeft <= 1 ? "lastDay" : "daysLeft", { days: s.trial.daysLeft, plan: tp(`plan.${s.trial.plan}`), n })}</p>
          <p className="text-body-sm text-text-2">{t("endsOn")} <DateText value={s.trial.endsAt} /></p>
          <p className="text-caption text-text-3">{t("after")}</p>
        </>
      ) : s.lastTrial && s.plan === "free" ? (
        <p className="text-body-sm text-text-2">{t("ended", { plan: tp(`plan.${s.lastTrial.plan}`) })}</p>
      ) : s.comped ? <p className="text-body-sm text-text-2">{t("comped")}</p> : null}
    </section>
  );
}
