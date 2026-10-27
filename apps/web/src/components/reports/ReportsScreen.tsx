"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { Tabs } from "@/components/ui/Tabs";
import { MoneyText } from "@/components/ui/Values";
import { ok, type Schemas } from "@/lib/api/client";
import { formatMoney } from "@/lib/format";
import { useSession } from "@/lib/session";

type Dashboard = Schemas["Dashboard"];
type DashboardId = Dashboard["id"];
type Tile = Dashboard["tiles"][number];
type Series = Dashboard["series"][number];
const PERIODS = [7, 30, 90] as const;
/** A store day shown without shifting through a midnight. */
const noon = (day: string) => new Date(`${day}T12:00:00Z`);

/**
 * M20 reports (E15-2): the built-in dashboards. Every tile comes from the metric layer (the same
 * number as on every other screen); each role sees only its dashboards and tiles; the dashboard
 * downloads as Excel or CSV with the same numbers.
 */
export function ReportsScreen() {
  const t = useTranslations("reports");
  const { api, user, store } = useSession();
  const [picked, setPicked] = useState<DashboardId | null>(null);
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const list = useQuery({
    queryKey: ["dashboards", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/dashboards")),
    enabled: Boolean(store),
  });
  const ids = list.data?.data ?? [];
  const id = picked && ids.some((d) => d.id === picked) ? picked : ids[0]?.id ?? null;
  const dash = useQuery({
    queryKey: ["dashboard", user?.uid ?? "", store?.tenantId ?? "", id, days],
    queryFn: () => ok(api.GET("/v1/dashboards/{id}", { params: { path: { id: id! }, query: { days } } })),
    enabled: Boolean(store) && id !== null,
    placeholderData: (prev) => prev,
  });

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="reports">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg">{t("title")}</h1>
          <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
        </div>
        <nav aria-label={t("period.label")} className="mz-tabs">
          {PERIODS.map((d) => (
            <button key={d} type="button" className="mz-tab" aria-current={days === d ? "true" : undefined} onClick={() => setDays(d)}>{t("period.days", { days: d })}</button>
          ))}
        </nav>
      </header>
      {list.isPending ? <div className="mz-card"><SkeletonRows rows={4} label={t("loading")} /></div>
        : list.isError ? <Alert tone="danger">{t("loadFailed")}</Alert>
        : id === null ? <div className="mz-card"><EmptyState icon="locked" title={t("none.title")} body={t("none.body")} /></div>
        : (
          <Tabs label={t("tabsLabel")} value={id} onChange={setPicked} items={ids.map((d) => ({ value: d.id, label: d.name }))}>
            {dash.isPending ? <div className="mz-card"><SkeletonRows rows={4} label={t("loading")} /></div>
              : dash.isError ? <Alert tone="danger">{t("loadFailed")}</Alert>
              : <DashboardView d={dash.data} days={days} />}
          </Tabs>
        )}
    </div>
  );
}

function DashboardView({ d, days }: { d: Dashboard; days: number }) {
  const t = useTranslations("reports");
  return (
    <div className="flex flex-col gap-4" data-testid={`dashboard-${d.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-text-2">{t.rich("range", { from: () => <bdi dir="ltr">{d.from}</bdi>, to: () => <bdi dir="ltr">{d.to}</bdi> })}</p>
        <Downloads d={d} days={days} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="tiles">
        {d.tiles.map((tile) => <StatCard key={tile.key} label={tile.name} value={<TileValue tile={tile} />} period={tile.definition} />)}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {d.series.map((s) => <SeriesChart key={s.key} s={s} currency={d.currency} />)}
      </div>
    </div>
  );
}

function TileValue({ tile }: { tile: Tile }) {
  const t = useTranslations("reports");
  if (tile.value === null) return <>—</>;
  if (tile.unit === "money" && tile.money) return <MoneyText money={tile.money} />;
  if (tile.unit === "percent") return <>{t("pct", { v: tile.value })}</>;
  if (tile.unit === "days") return <>{t("days", { v: tile.value })}</>;
  return <>{tile.value}</>;
}

/** Daily bars; time runs left to right in both languages (charts are never mirrored). Losses in red. */
function SeriesChart({ s, currency }: { s: Series; currency: string }) {
  const t = useTranslations("reports");
  const locale = useLocale();
  const values = s.points.map((p) => Number(p.value));
  const top = Math.max(0, ...values);
  const bottom = Math.max(0, ...values.map((v) => -v));
  const H = 100;
  const scale = H / Math.max(top + bottom, Number.EPSILON);
  const zero = top * scale;
  const w = 100 / Math.max(1, values.length);
  const fmtDay = (day: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(noon(day));
  const fmt = (v: string) => (s.unit === "money" ? formatMoney({ amount: v, currency }, locale) : v);
  const total = s.unit === "money" ? null : values.reduce((a, b) => a + b, 0);
  return (
    <section className="mz-card flex flex-col gap-3 p-5" aria-labelledby={`series-${s.key}`} data-testid={`series-${s.key}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`series-${s.key}`} className="text-heading-sm">{s.name}</h2>
        {total !== null ? <p className="text-caption text-text-3">{t("total", { n: total })}</p> : null}
      </div>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="h-32 w-full" role="img" aria-label={s.name}>
        <line x1="0" x2="100" y1={zero} y2={zero} className="stroke-line" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        {s.points.map((p, i) => {
          const v = values[i]!;
          const hgt = Math.abs(v) * scale;
          return (
            <g key={p.day} className="group">
              <rect x={i * w} y={0} width={w} height={H} className="fill-transparent group-hover:fill-surface-hover" />
              {v !== 0 ? <rect x={i * w + w * 0.18} y={v > 0 ? zero - hgt : zero} width={w * 0.64} height={Math.max(hgt, 0.8)} rx="0.6" className={v < 0 ? "fill-danger" : "fill-text-2"} /> : null}
              <title>{t("tip", { day: fmtDay(p.day), value: fmt(p.value) })}</title>
            </g>
          );
        })}
      </svg>
      <div dir="ltr" className="flex justify-between text-caption text-text-3" aria-hidden="true">
        <span>{fmtDay(s.points[0]?.day ?? "")}</span><span>{fmtDay(s.points.at(-1)?.day ?? "")}</span>
      </div>
      <table className="sr-only">
        <caption>{s.name}</caption>
        <thead><tr><th>{t("day")}</th><th>{s.name}</th></tr></thead>
        <tbody>{s.points.map((p) => <tr key={p.day}><td>{fmtDay(p.day)}</td><td>{fmt(p.value)}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

/** The dashboard as a file, fetched with the session (the API needs the bearer token), then saved. */
function Downloads({ d, days }: { d: Dashboard; days: number }) {
  const t = useTranslations("reports");
  const { api } = useSession();
  const download = useMutation({
    mutationFn: async (format: "xlsx" | "csv") => {
      const blob = await ok(api.GET("/v1/dashboards/{id}/export", { params: { path: { id: d.id }, query: { days, format } }, parseAs: "blob" })) as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mizan-${d.id}-${d.from}-${d.to}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  return (
    <div className="flex gap-2">
      <Button variant="secondary" icon="download" busy={download.isPending && download.variables === "xlsx"} onClick={() => download.mutate("xlsx")}>{t("excel")}</Button>
      <Button variant="secondary" icon="download" busy={download.isPending && download.variables === "csv"} onClick={() => download.mutate("csv")}>{t("csv")}</Button>
    </div>
  );
}
