"use client";

import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { buttonClass } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { SkeletonRows } from "@/components/ui/Surface";
import { MoneyText } from "@/components/ui/Values";
import { StoreName } from "@/components/StoreName";
import { PaymentMix } from "@/components/payments/PaymentMix";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { formatMoney } from "@/lib/format";
import { useSession } from "@/lib/session";

type Home = Schemas["ProfitHome"];
type Money = Home["period"]["net"];
type Leak = Home["leaks"][number];
const READERS = new Set(["owner", "admin", "finance", "ops_manager"]);
const PERIODS = [7, 30, 90] as const;
const minor = (m: Money) => Math.round(Number(m.amount) * 100);
const negative = (m: Money) => m.amount.startsWith("-");
/** A store day shown without shifting through a midnight. */
const noon = (day: string) => new Date(`${day}T12:00:00Z`);

const LEAK_LINK: Record<Leak["kind"], string> = {
  losing_orders: "/orders", refusals: "/orders", unallocated_ads: "/settings/ads", other_currency: "/settings/costs",
  cost_missing: "/onboarding", shipping_rate_missing: "/settings/costs", cod_fee_missing: "/settings/costs", agent_cost_missing: "/settings/costs",
  packaging_cost_missing: "/settings/costs", payment_fee_missing: "/settings/costs", fx_missing: "/settings/costs", ads_fx_missing: "/settings/costs", sync_gap: "/onboarding",
};
const LEAK_ICON: Record<Leak["kind"], IconProps["name"]> = {
  losing_orders: "warning", refusals: "warning", unallocated_ads: "finance", other_currency: "finance", cost_missing: "info", shipping_rate_missing: "info",
  cod_fee_missing: "info", agent_cost_missing: "info", packaging_cost_missing: "info", payment_fee_missing: "info", fx_missing: "info", ads_fx_missing: "info",
  sync_gap: "warning",
};

/**
 * The profit home (M5, E9-4): what the store kept over the last 7, 30 or 90 days, of every 100
 * of revenue how much stayed, where each pound went, yesterday, delivery and refusals, cash with
 * couriers, profit per day and the leaks to fix. People who don't see profit (agents) and stores
 * without orders yet see `fallback` (the welcome and setup).
 */
export function ProfitHome({ fallback, setup }: { fallback: ReactNode; setup: ReactNode }) {
  const t = useTranslations("profitHome");
  const locale = useLocale();
  const { api, user, store } = useSession();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const canRead = READERS.has(store?.role ?? "");
  const q = useQuery({
    queryKey: ["profitHome", user?.uid ?? "", store?.tenantId ?? "", days],
    queryFn: () => ok(api.GET("/v1/profit/home", { params: { query: { days } } })),
    enabled: Boolean(store) && canRead,
    placeholderData: (prev) => prev,
  });
  if (!store || !canRead) return <>{fallback}</>;
  if (q.isPending) return <div className="mz-card"><SkeletonRows rows={6} label={t("loading")} /></div>;
  if (q.isError) return <><Alert tone="danger">{t("loadFailed")}</Alert>{fallback}</>;
  const h = q.data;
  // Nothing yet (a new store): the welcome and setup instead of a page of zeros.
  if (h.period.orders === 0 && minor(h.period.previousKept) === 0 && minor(h.period.adSpend) === 0 && minor(h.period.fixedCosts) === 0) return <>{fallback}</>;
  const p = h.period;

  return (
    <div className="flex flex-col gap-4" data-testid="profit-home">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <StoreName className="text-overline uppercase text-text-3" />
          <h1 className="mt-1 font-display text-heading-lg">{t("title")}</h1>
          <p className="mt-1.5 max-w-[62ch] text-body text-text-2">{t("subtitle")}</p>
        </div>
      <nav aria-label={t("period.label")} className="mz-tabs">
        {PERIODS.map((d) => (
          <button key={d} type="button" className="mz-tab" aria-current={days === d ? "true" : undefined} onClick={() => setDays(d)}>{t("period.days", { days: d })}</button>
        ))}
      </nav>
      </header>
      {setup}

      <section className="mz-card flex flex-col gap-4 p-5" aria-labelledby="kept-title" data-testid="kept">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div>
            <h2 id="kept-title" className="text-overline uppercase text-text-3">{t("kept.title", { days: h.days })}</h2>
            <p className={`font-display text-display-md ${negative(p.kept) ? "text-danger-text" : ""}`}><MoneyText money={p.kept} /></p>
          </div>
          {p.change !== null ? (
            <p className="pb-1.5 text-body-sm text-text-3">
              <bdi dir="ltr" className={negative({ amount: p.change, currency: "" }) ? "text-danger-text" : "text-success-text"}>{t("kept.change", { pct: `${p.change.startsWith("-") ? "" : "+"}${p.change}` })}</bdi>{" "}{t("kept.vsPrev", { days: h.days })}
            </p>
          ) : null}
        </div>
        {p.keptPer100 ? (
          <p className="text-body">{t.rich("kept.per100", { hundred: () => <b><MoneyText money={{ amount: "100.00", currency: h.baseCurrency }} /></b>, kept: () => <b><MoneyText money={p.keptPer100!} /></b> })}</p>
        ) : <p className="text-body text-text-2">{t("kept.noRevenue")}</p>}
        {p.expectedKept.amount !== p.kept.amount ? (
          <p className="text-body-sm text-text-2" data-testid="expected">{t.rich("kept.expected", { money: () => <b><MoneyText money={p.expectedKept} /></b> })}</p>
        ) : null}
        <Breakdown home={h} />
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="kpis">
        <StatCard label={t("kpi.yesterday")} value={<MoneyText money={h.yesterday.expectedNet} />}
          period={t("kpi.yesterdayHint", { orders: h.yesterday.orders })} />
        <StatCard label={t("kpi.delivery")} value={p.deliveryRate !== null ? t("pct", { v: p.deliveryRate }) : "—"}
          period={t("kpi.deliveryHint", { delivered: p.delivered, returned: p.returned })} />
        <StatCard label={t("kpi.refusals")} value={<MoneyText money={p.refusalLoss} />} period={t("kpi.refusalsHint", { count: p.returned })} />
        <StatCard label={t("kpi.cash")} value={<MoneyText money={sum(h.cash.inTransit, h.cash.awaitingRemittance)} />}
          period={t("kpi.cashHint", { transit: formatMoney(h.cash.inTransit, locale), held: formatMoney(h.cash.awaitingRemittance, locale) })} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Trend home={h} />
        <Leaks leaks={h.leaks} />
      </div>
      <PaymentMix days={days} />
    </div>
  );
}

function sum(a: Money, b: Money): Money {
  const v = minor(a) + minor(b);
  return { amount: `${v < 0 ? "-" : ""}${Math.floor(Math.abs(v) / 100)}.${String(Math.abs(v) % 100).padStart(2, "0")}`, currency: a.currency };
}

/** Where every pound of revenue went: one row per cost, a bar its share of revenue, what was kept last. */
function Breakdown({ home }: { home: Home }) {
  const t = useTranslations("profitHome.where");
  const b = home.period.breakdown;
  const revenue = minor(b.revenue);
  const rows = ([["productCost", b.productCost], ["shippingAndCod", b.shippingAndCod], ["ads", b.ads], ["returns", b.returns], ["team", b.team], ["fees", b.fees], ["fixed", b.fixed]] as const)
    .filter(([, m]) => minor(m) !== 0);
  const share = (m: Money) => (revenue > 0 ? Math.min(100, Math.abs(minor(m)) / revenue * 100) : 0);
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      <h3 className="text-body-sm font-medium">{t("title")}{" · "}<span className="text-text-2">{t("revenue")}{" "}<MoneyText money={b.revenue} /></span></h3>
      <ul className="flex flex-col gap-2" data-testid="breakdown">
        {[...rows, ["kept", b.kept] as const].map(([k, m]) => {
          const kept = k === "kept";
          const loss = kept && negative(m);
          return (
            <li key={k} className="grid grid-cols-[minmax(6rem,10rem)_1fr_minmax(9rem,auto)] items-center gap-3 text-body-sm">
              <span className={kept ? "font-medium" : "text-text-2"}>{t(k)}</span>
              <span className="h-2 rounded-full bg-surface-sunk" aria-hidden="true">
                <span className={`block h-2 rounded-full ${loss ? "bg-danger" : kept ? "bg-text" : "bg-text-3"}`} style={{ inlineSize: `${share(m)}%` }} />
              </span>
              <span className={`text-end ${loss ? "text-danger-text" : ""}`}><MoneyText money={m} />{revenue > 0 ? <span className="ms-2 text-text-3">{t("share", { pct: share(m).toFixed(1) })}</span> : null}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Profit per day: what each day's orders make if those on their way deliver; losses in red. */
function Trend({ home }: { home: Home }) {
  const t = useTranslations("profitHome.trend");
  const locale = useLocale();
  const values = home.trend.map((d) => minor(d.expectedNet));
  // One axis from the deepest loss to the best day: the zero line sits where it falls.
  const top = Math.max(0, ...values);
  const bottom = Math.max(0, ...values.map((v) => -v));
  const H = 120;
  const scale = H / Math.max(1, top + bottom);
  const zero = top * scale;
  const w = 100 / values.length;
  const fmtDay = (d: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(noon(d));
  return (
    <section className="mz-card flex flex-col gap-3 p-5 lg:col-span-2" aria-labelledby="trend-title">
      <div>
        <h2 id="trend-title" className="text-heading-sm">{t("title")}</h2>
        <p className="text-caption text-text-3">{t("hint")}</p>
      </div>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="h-36 w-full" role="img" aria-label={t("title")} data-testid="trend">
        <line x1="0" x2="100" y1={zero} y2={zero} className="stroke-line" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        {home.trend.map((d, i) => {
          const v = values[i]!;
          const hgt = Math.abs(v) * scale;
          return (
            <g key={d.day} className="group">
              <rect x={i * w} y={0} width={w} height={H} className="fill-transparent group-hover:fill-surface-hover" />
              {v !== 0 ? (
                <rect x={i * w + w * 0.18} y={v > 0 ? zero - hgt : zero} width={w * 0.64} height={Math.max(hgt, 0.8)} rx="0.6" className={v < 0 ? "fill-danger" : "fill-text-2"} />
              ) : null}
              <title>{t("tip", { day: fmtDay(d.day), money: formatMoney(d.expectedNet, locale), count: d.orders })}</title>
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-caption text-text-3" aria-hidden="true">
        <span>{fmtDay(home.from)}</span><span>{fmtDay(home.to)}</span>
      </div>
      <table className="sr-only">
        <caption>{t("title")}</caption>
        <thead><tr><th>{t("day")}</th><th>{t("orders", { count: 2 })}</th><th>{t("profit")}</th></tr></thead>
        <tbody>{home.trend.map((d) => <tr key={d.day}><td>{fmtDay(d.day)}</td><td>{d.orders}</td><td><MoneyText money={d.expectedNet} /></td></tr>)}</tbody>
      </table>
    </section>
  );
}

/** Leaks: what is costing money, or hiding it, with where to fix it. */
function Leaks({ leaks }: { leaks: Leak[] }) {
  const t = useTranslations("profitHome.leaks");
  return (
    <section className="mz-card flex flex-col gap-3 p-5" aria-labelledby="leaks-title" data-testid="leaks">
      <h2 id="leaks-title" className="text-heading-sm">{t("title")}</h2>
      {leaks.length === 0 ? <p className="text-body-sm text-text-2">{t("none")}</p> : (
        <ul className="flex flex-col divide-y divide-line">
          {leaks.map((l) => (
            <li key={l.kind} className="flex items-start gap-3 py-2.5">
              <Icon name={LEAK_ICON[l.kind]} size={16} className={l.amount ? "mt-0.5 text-danger-text" : "mt-0.5 text-text-3"} />
              <div className="flex-1 text-body-sm">
                <p className="font-medium">{t(`${l.kind}.title`, { count: l.count })}</p>
                {l.amount ? <p className="text-text-2">{t.rich(`${l.kind}.body`, { count: l.count, money: () => <MoneyText money={l.amount!} /> })}</p> : <p className="text-text-2">{t(`${l.kind}.body`, { count: l.count })}</p>}
              </div>
              <Link href={LEAK_LINK[l.kind]} className={buttonClass("ghost", "sm")}>{t("open")}<Icon name="forward" size={14} /></Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
