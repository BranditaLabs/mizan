"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { MoneyText } from "@/components/ui/Values";
import { ok, type Schemas } from "@/lib/api/client";
import { downloadText, toCsv } from "@/lib/csv";
import { formatDate } from "@/lib/format";
import { useSession } from "@/lib/session";

type Breakdown = Schemas["ProfitBreakdown"];
type Row = Breakdown["rows"][number];
type By = Breakdown["by"];
const DIMENSIONS: readonly By[] = ["day", "product", "store", "courier", "country"];
const PERIODS = [7, 30, 90] as const;
const READERS = new Set(["owner", "admin", "finance", "ops_manager"]);

/**
 * Profit breakdown (M5, E9-5): where the profit comes from and where it leaks, by day, product,
 * store, courier or country, over the last 7, 30 or 90 store days; the same rows as a CSV for the
 * accountant. Money counts when it is real (COD once delivered); "expected" adds orders on their way.
 */
export function ProfitBreakdown() {
  const t = useTranslations("profitBreakdown");
  const locale = useLocale();
  const { api, user, store } = useSession();
  const allowed = READERS.has(store?.role ?? "");
  const [by, setBy] = useState<By>("product");
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const query = useQuery({
    queryKey: ["profitBreakdown", user?.uid ?? "", store?.tenantId ?? "", by, days],
    queryFn: () => ok(api.GET("/v1/profit/breakdown", { params: { query: { by, days } } })),
    enabled: Boolean(store) && allowed,
  });

  const region = (code: string) => {
    try { return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code; } catch { return code; }
  };
  const labelOf = (r: Row): string =>
    r.special ? t(`special.${r.key as "manual" | "none" | "unknown" | "no_products"}`)
    : by === "day" ? formatDate(r.key, locale, "latn", "short")
    : by === "country" ? region(r.key)
    : by === "courier" ? r.label.charAt(0).toUpperCase() + r.label.slice(1)
    : r.label;

  const exportCsv = (b: Breakdown) => {
    const head = [t(`dimension.${b.by}`), t("col.orders"), t("col.delivered"), t("col.returned"), t("col.revenue"), t("col.productCost"), t("col.shipping"), t("col.ads"),
      t("col.returns"), t("col.team"), t("col.fees"), t("col.net"), t("col.expectedNet"), t("col.margin")];
    const line = (r: Row, label: string) => [label, r.orders, r.delivered, r.returned, r.revenue.amount, r.productCost.amount, r.shippingAndCod.amount, r.ads.amount,
      r.returns.amount, r.team.amount, r.fees.amount, r.net.amount, r.expectedNet.amount, r.margin];
    const csv = toCsv([head, ...b.rows.map((r) => line(r, by === "day" ? r.key : labelOf(r))), line(b.total, t("total"))]);
    downloadText(`mizan-profit-${b.by}-${b.from}-${b.to}.csv`, csv);
  };

  const frame = (body: React.ReactNode, actions?: React.ReactNode) => (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="profit-breakdown">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg">{t("title")}</h1>
          <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
        </div>
        {actions}
      </header>
      {body}
    </div>
  );
  if (!allowed) return frame(<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>);

  const b = query.data;
  return frame(
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t("groupBy")} className="mz-tabs">
          {DIMENSIONS.map((d) => <button key={d} type="button" className="mz-tab" aria-current={by === d ? "true" : undefined} onClick={() => setBy(d)}>{t(`dimension.${d}`)}</button>)}
        </nav>
        <nav aria-label={t("period")} className="mz-tabs">
          {PERIODS.map((d) => <button key={d} type="button" className="mz-tab" aria-current={days === d ? "true" : undefined} onClick={() => setDays(d)}>{t("days", { days: d })}</button>)}
        </nav>
      </div>
      {query.isPending ? <div className="mz-card"><SkeletonRows rows={6} label={t("loading")} /></div> : null}
      {query.isError ? <Alert tone="danger">{t("loadFailed")}</Alert> : null}
      {b && b.rows.length === 0 ? <div className="mz-card"><EmptyState icon="profit" title={t("empty.title")} body={t("empty.body")} /></div> : null}
      {b && b.rows.length > 0 ? (
        <div className="mz-table-wrap">
          <table className="mz-table" data-testid="breakdown-table">
            <caption className="sr-only">{t("caption", { dimension: t(`dimension.${b.by}`) })}</caption>
            <thead>
              <tr>
                <th scope="col">{t(`dimension.${b.by}`)}</th>
                <th scope="col" className="mz-num">{t("col.orders")}</th>
                <th scope="col" className="mz-num">{t("col.revenue")}</th>
                <th scope="col" className="mz-num">{t("col.productCost")}</th>
                <th scope="col" className="mz-num">{t("col.shipping")}</th>
                <th scope="col" className="mz-num">{t("col.ads")}</th>
                <th scope="col" className="mz-num">{t("col.net")}</th>
                <th scope="col" className="mz-num">{t("col.margin")}</th>
                <th scope="col" className="mz-num">{t("col.expectedNet")}</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => <BreakdownLine key={r.key} r={r} label={labelOf(r)} />)}
            </tbody>
            <tfoot>
              <BreakdownLine r={b.total} label={t("total")} strong />
            </tfoot>
          </table>
        </div>
      ) : null}
      <p className="text-caption text-text-3">{t("note")}</p>
    </>,
    <Button variant="secondary" icon="download" disabled={!b || b.rows.length === 0} onClick={() => b && exportCsv(b)}>{t("export")}</Button>,
  );
}

function BreakdownLine({ r, label, strong = false }: { r: Row; label: string; strong?: boolean }) {
  const t = useTranslations("profitBreakdown");
  const negative = r.net.amount.startsWith("-");
  const Cell = strong ? "th" : "td";
  return (
    <tr className={strong ? "font-semibold" : undefined}>
      <th scope="row" className={strong ? undefined : "font-medium"}>
        <span className="block">{label}</span>
        {r.delivered + r.returned > 0 ? <span className="block text-caption font-normal text-text-3">{t("outcome", { delivered: r.delivered, returned: r.returned })}</span> : null}
      </th>
      <Cell className="mz-num"><bdi>{r.orders}</bdi></Cell>
      <Cell className="mz-num"><MoneyText money={r.revenue} /></Cell>
      <Cell className="mz-num"><MoneyText money={r.productCost} /></Cell>
      <Cell className="mz-num"><MoneyText money={r.shippingAndCod} /></Cell>
      <Cell className="mz-num"><MoneyText money={r.ads} /></Cell>
      <Cell className={`mz-num ${negative ? "text-danger-text" : ""}`}><MoneyText money={r.net} /></Cell>
      <Cell className={`mz-num ${negative ? "text-danger-text" : ""}`}><bdi>{r.margin === null ? t("none") : t("pct", { pct: r.margin })}</bdi></Cell>
      <Cell className="mz-num text-text-2"><MoneyText money={r.expectedNet} /></Cell>
    </tr>
  );
}
