"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { buttonClass } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { Card, EmptyState, KeyValue, SkeletonRows } from "@/components/ui/Surface";
import { MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { useSession } from "@/lib/session";

type Roas = Schemas["Roas"];
const PERIODS = [7, 14, 30, 90] as const;
const READERS = new Set(["owner", "admin", "finance", "ops_manager"]);
const PLATFORMS = new Set(["meta", "tiktok", "google", "snapchat", "other"]);

/**
 * True ROAS (M7-1): what the ads really brought. Ad platforms count every checkout; with cash on
 * delivery many never pay. This screen follows the period's orders to the money: true ROAS (money
 * that arrived), next to what the platform would report and what the orders still on their way
 * should add, and the ad cost of each order that was actually delivered.
 */
export function AdsRoas() {
  const t = useTranslations("adsRoas");
  const locale = useLocale();
  const { api, user, store } = useSession();
  const allowed = READERS.has(store?.role ?? "");
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const q = useQuery({
    queryKey: ["roas", user?.uid ?? "", store?.tenantId ?? "", days],
    queryFn: () => ok(api.GET("/v1/attribution/roas", { params: { query: { days } } })),
    enabled: Boolean(store) && allowed,
  });

  const frame = (body: React.ReactNode) => (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="ads-roas">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg">{t("title")}</h1>
          <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
        </div>
        <Link href="/settings/ads" className={buttonClass("secondary")}>{t("enterSpend")}</Link>
      </header>
      {body}
    </div>
  );
  if (!allowed) return frame(<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>);

  const r = q.data;
  /** A multiple: the number isolated left to right, the word ("ضعف") or sign (×) in the page's direction. */
  const x = (v: string | null) => (v === null ? t("none") : t.rich("times", { v, n: (c) => <bdi className="mz-num">{c}</bdi> }));
  const kpi = (v: string | null) => ({ value: v ?? t("none"), unit: v === null ? undefined : t("timesUnit") });
  const noSpend = r && Number(r.spend.amount) === 0;
  return frame(
    <>
      <nav aria-label={t("period")} className="mz-tabs self-start">
        {PERIODS.map((d) => <button key={d} type="button" className="mz-tab" aria-current={days === d ? "true" : undefined} onClick={() => setDays(d)}>{t("days", { days: d })}</button>)}
      </nav>
      {q.isPending ? <div className="mz-card"><SkeletonRows rows={5} label={t("loading")} /></div> : null}
      {q.isError ? <Alert tone="danger">{t("loadFailed")}</Alert> : null}
      {r && noSpend ? (
        <div className="mz-card">
          <EmptyState icon="profit" title={t("empty.title")} body={t("empty.body")} action={<Link href="/settings/ads" className={buttonClass("primary")}>{t("enterSpend")}</Link>} />
        </div>
      ) : null}
      {r && !noSpend ? (
        <>
          {r.fxMissing ? <Alert tone="warning">{t("fxMissing")}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="roas-kpis">
            <StatCard hero label={t("kpi.true")} {...kpi(r.trueRoas)} period={t.rich("kpi.trueHint", { real: () => <MoneyText money={r.money.real} />, spend: () => <MoneyText money={r.spend} /> })} />
            <StatCard label={t("kpi.reported")} {...kpi(r.reportedRoas)} period={t("kpi.reportedHint")} />
            <StatCard label={t("kpi.projected")} {...kpi(r.projectedRoas)} period={t("kpi.projectedHint", { moving: r.orders.moving })} />
            <StatCard label={t("kpi.perDelivered")} value={r.costPerDelivered ? <MoneyText money={r.costPerDelivered} /> : t("none")}
              period={r.costPerOrder ? t.rich("kpi.perOrder", { cost: () => <MoneyText money={r.costPerOrder!} /> }) : null} />
          </div>
          <Gap r={r} />
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Card title={t("daysTitle")} bodyClassName="p-0">
              <div className="mz-table-wrap border-0">
                <table className="mz-table" data-testid="roas-days">
                  <caption className="sr-only">{t("daysTitle")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("col.day")}</th>
                      <th scope="col" className="mz-num">{t("col.spend")}</th>
                      <th scope="col" className="mz-num">{t("col.orders")}</th>
                      <th scope="col" className="mz-num">{t("col.delivered")}</th>
                      <th scope="col" className="mz-num">{t("col.real")}</th>
                      <th scope="col" className="mz-num">{t("col.roas")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...r.days].reverse().filter((d) => d.orders > 0 || Number(d.spend.amount) > 0).map((d) => (
                      <tr key={d.day}>
                        <th scope="row" className="font-medium">{formatDate(d.day, locale, "latn", "short")}</th>
                        <td className="mz-num"><MoneyText money={d.spend} /></td>
                        <td className="mz-num"><bdi>{d.orders}</bdi></td>
                        <td className="mz-num"><bdi>{d.delivered}</bdi></td>
                        <td className="mz-num"><MoneyText money={d.real} /></td>
                        <td className="text-end tabular-nums">{x(d.trueRoas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <div className="flex flex-col gap-4">
              <Card title={t("platformsTitle")}>
                <ul className="flex flex-col gap-2" data-testid="roas-platforms">
                  {r.byPlatform.map((p) => (
                    <li key={p.platform} className="flex items-center justify-between gap-3 text-body-sm">
                      <span>{PLATFORMS.has(p.platform) ? t(`platform.${p.platform}`) : p.platform}</span>
                      <span className="flex items-center gap-2"><MoneyText money={p.spend} />{p.share ? <span className="text-caption text-text-3">{t("share", { pct: p.share })}</span> : null}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-caption text-text-3">{t("perCampaignSoon")}</p>
              </Card>
              <Card title={t("ordersTitle")}>
                <KeyValue items={[
                  { label: t("orders.placed"), value: <bdi>{r.orders.placed}</bdi> },
                  { label: t("orders.delivered"), value: <bdi>{r.orders.delivered}</bdi> },
                  { label: t("orders.moving"), value: <bdi>{r.orders.moving}</bdi> },
                  { label: t("orders.returned"), value: <bdi>{r.orders.returned}</bdi> },
                  { label: t("orders.cancelled"), value: <bdi>{r.orders.cancelled}</bdi> },
                  { label: t("orders.net"), value: <MoneyText money={r.money.net} /> },
                ]} />
              </Card>
            </div>
          </div>
          <p className="text-caption text-text-3">{t("note")}</p>
        </>
      ) : null}
    </>,
  );
}

/** The gap between what the platform would claim and what arrived, in plain words. */
function Gap({ r }: { r: Roas }) {
  const t = useTranslations("adsRoas");
  if (r.lostShare === null || r.orders.placed === 0) return null;
  return (
    <Alert tone={Number(r.lostShare) >= 20 ? "warning" : "info"}>
      {t.rich("gap", {
        lost: r.lostShare, placed: r.orders.placed,
        reported: r.reportedRoas ?? "—", real: r.trueRoas ?? "—",
        b: (c) => <strong><bdi className="mz-num">{c}</bdi></strong>,
      })}
    </Alert>
  );
}
