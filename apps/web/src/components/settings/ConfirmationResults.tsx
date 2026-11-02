"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { StatCard } from "@/components/ui/StatCard";
import { Card, SkeletonRows } from "@/components/ui/Surface";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type Summary = Schemas["ConfirmationSummary"];
const PERIODS = [7, 30, 90] as const;

/**
 * Confirmation results (E6-6), on Settings → Confirmation: the rate over decided orders, what is
 * waiting on the team, the median time to confirm, and the same by route (E6-2) and by the channel
 * that got the answer, so the owner can see what routing and each channel do.
 */
export function ConfirmationResults() {
  const t = useTranslations("confirmationSettings.results");
  const { api, user, store } = useSession();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const query = useQuery({
    queryKey: ["confirmationSummary", user?.uid ?? "", store?.tenantId ?? "", days],
    queryFn: () => ok(api.GET("/v1/confirmation/summary", { params: { query: { days } } })),
    enabled: Boolean(store),
  });
  const s = query.data;
  const pct = (rate: string | null) => (rate === null ? t("none") : t("pct", { pct: rate }));
  /** Under an hour in minutes, else h:mm with the unit beside it (no wrapping in either language). */
  const duration = (m: number | null) =>
    m === null ? { value: t("none"), unit: undefined } : m < 60 ? { value: String(m), unit: t("minutes") } : { value: `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`, unit: t("hours") };
  const median = duration(s?.medianMinutes ?? null);

  return (
    <div data-testid="confirmation-results">
    <Card title={t("title")}
      actions={
        <nav aria-label={t("period")} className="mz-tabs">
          {PERIODS.map((d) => (
            <button key={d} type="button" className="mz-tab" aria-current={days === d ? "true" : undefined} onClick={() => setDays(d)}>{t("days", { days: d })}</button>
          ))}
        </nav>
      }>
      {query.isPending ? <SkeletonRows rows={3} label={t("loading")} /> : null}
      {query.isError ? <p className="text-body-sm text-danger-text">{t("loadFailed")}</p> : null}
      {s && s.orders === 0 ? <p className="text-body-sm text-text-2">{t("empty")}</p> : null}
      {s && s.orders > 0 ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label={t("rate")} value={pct(s.rate)} period={t("decided", { n: s.confirmed + s.cancelled, orders: s.orders })} />
            <StatCard label={t("confirmed")} value={s.confirmed} period={t("cancelledN", { n: s.cancelled })} />
            <StatCard label={t("needsTeam")} value={s.needsTeam} period={t("pendingN", { n: s.pending })} />
            <StatCard label={t("median")} value={median.value} unit={median.unit} period={t("medianHint")} />
          </div>
          <Breakdown s={s} pct={pct} />
        </div>
      ) : null}
    </Card>
    </div>
  );
}

function Breakdown({ s, pct }: { s: Summary; pct: (rate: string | null) => string }) {
  const t = useTranslations("confirmationSettings.results");
  return (
    <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
      <div className="mz-table-wrap">
        <table className="mz-table" data-testid="results-by-route">
          <caption className="sr-only">{t("byRoute")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("col.route")}</th>
              <th scope="col" className="mz-num">{t("col.orders")}</th>
              <th scope="col" className="mz-num">{t("col.confirmed")}</th>
              <th scope="col" className="mz-num">{t("col.cancelled")}</th>
              <th scope="col" className="mz-num">{t("col.rate")}</th>
            </tr>
          </thead>
          <tbody>
            {s.byRoute.map((r) => (
              <tr key={r.route}>
                <th scope="row" className="font-medium">{t(`route.${r.route}`)}</th>
                <td className="mz-num"><bdi>{r.orders}</bdi></td>
                <td className="mz-num"><bdi>{r.confirmed}</bdi></td>
                <td className="mz-num"><bdi>{r.cancelled}</bdi></td>
                <td className="mz-num"><bdi>{pct(r.rate)}</bdi></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section aria-labelledby="by-channel" data-testid="results-by-channel">
        <h3 id="by-channel" className="text-overline uppercase text-text-3">{t("byChannel")}</h3>
        <ul className="mt-2 flex flex-col gap-2">
          {s.byChannel.map((c) => {
            const total = c.confirmed + c.cancelled;
            const share = total ? Math.round((c.confirmed / total) * 100) : 0;
            return (
              <li key={c.channel} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3 text-body-sm">
                  <span>{t(`channel.${c.channel}`)}</span>
                  <span className="text-text-2">{t("channelCounts", { confirmed: c.confirmed, cancelled: c.cancelled })}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunk" role="img" aria-label={t("channelShare", { pct: share })}>
                  <div className="h-full rounded-full bg-text" style={{ inlineSize: `${share}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
