"use client";

import { rolesWith } from "@mizan/shared";
import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState, type CSSProperties, type ReactNode } from "react";
import { buttonClass } from "@/components/ui/Button";
import { SegThumb } from "@/components/ui/Choice";
import { RedSwatch } from "@mizan/design-system/react/motion";
import { Waiting } from "@/components/ui/Loader";
import { PageState } from "@/components/ui/QueryState";
import { MoneyText } from "@/components/ui/Values";
import { GlassRoot } from "@/components/GlassRoot";
import { StoreName } from "@/components/StoreName";
import { PaymentMix } from "@/components/payments/PaymentMix";
import { ActivityLog } from "./ActivityLog";
import { ProfitChart } from "./ProfitChart";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { formatMoney } from "@/lib/format";
import { useSession } from "@/lib/session";
import { MotionSurface } from "@/components/ui/MotionSurface";

type Home = Schemas["ProfitHome"];
type Money = Home["period"]["net"];
type Leak = Home["leaks"][number];
const READERS = rolesWith("profit.read");
const PERIODS = [7, 30, 90] as const;
const REFRESH_MS = 60_000;
const minor = (m: Money) => Math.round(Number(m.amount) * 100);
const negative = (m: Money) => m.amount.startsWith("-");
const order = (i: number) => ({ "--i": i }) as CSSProperties;

const LEAK_LINK: Record<Leak["kind"], string> = {
  losing_orders: "/orders", refusals: "/orders", unallocated_ads: "/profit/spend", other_currency: "/settings/costs",
  cost_missing: "/products?view=missing_cost", shipping_rate_missing: "/settings/costs", cod_fee_missing: "/settings/costs", agent_cost_missing: "/settings/costs",
  packaging_cost_missing: "/settings/costs", payment_fee_missing: "/settings/costs", fx_missing: "/settings/costs", ads_fx_missing: "/settings/costs", sync_gap: "/onboarding",
};
const LEAK_ICON: Record<Leak["kind"], IconProps["name"]> = {
  losing_orders: "warning", refusals: "warning", unallocated_ads: "finance", other_currency: "finance", cost_missing: "info", shipping_rate_missing: "info",
  cod_fee_missing: "info", agent_cost_missing: "info", packaging_cost_missing: "info", payment_fee_missing: "info", fx_missing: "info", ads_fx_missing: "info",
  sync_gap: "warning",
};

/**
 * The profit home (M5, E9-4), Mizan's first screen: what the store kept over the last 7, 30 or 90
 * days, and the scale it comes from (every pound of revenue split into where it went, the kept part
 * last, in the one red), then yesterday, delivery, refusals and cash with couriers, profit per day and
 * the leaks to fix. It refreshes itself every minute; changed figures roll to their new value.
 * People who don't see profit (agents) and stores without orders yet see `fallback`.
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
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  if (!store || !canRead) return <>{fallback}</>;
  // A failed first load says so (with "try again") instead of the new store's welcome; a failed
  // background refresh keeps the figures on screen (the toast says so).
  if (!q.data) return <div className="mz-card flex min-h-[60dvh] items-center justify-center"><PageState query={q} variant="card" label={t("loading")} /></div>;
  const h = q.data;
  // Nothing yet (a new store): the welcome and setup instead of a page of zeros.
  if (h.period.orders === 0 && minor(h.period.previousKept) === 0 && minor(h.period.adSpend) === 0 && minor(h.period.fixedCosts) === 0) return <>{fallback}</>;
  const p = h.period;
  const updated = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit" }).format(q.dataUpdatedAt);

  return (
    <div className="flex flex-col gap-5" data-testid="profit-home">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-heading-lg">{t("title")}</h1>
          <div className="mt-1.5 flex max-w-[62ch] flex-wrap gap-x-1.5 text-body text-text-2">
            <StoreName className="font-medium text-text" />
            <p>{t("subtitle")}</p>
          </div>
        </div>
        <nav aria-label={t("period.label")} className="mz-segmented">
          <SegThumb index={PERIODS.indexOf(days)} />
          {PERIODS.map((d) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{t("period.days", { days: d })}</button>
          ))}
        </nav>
      </header>
      {setup}

      <Hero home={h} updated={updated} fetching={q.isFetching}>
        <div className="mz-stagger grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="kpis">
          <GlassStat i={0} label={t("kpi.yesterday")} value={<MoneyText money={h.yesterday.expectedNet} roll from="0" />} hint={t("kpi.yesterdayHint", { orders: h.yesterday.orders })} />
          <GlassStat i={1} label={t("kpi.delivery")} value={p.deliveryRate !== null ? t("pct", { v: p.deliveryRate }) : "—"}
            hint={t("kpi.deliveryHint", { delivered: p.delivered, returned: p.returned })} meter={p.deliveryRate !== null ? Number(p.deliveryRate) : null} />
          <GlassStat i={2} label={t("kpi.refusals")} value={<MoneyText money={p.refusalLoss} roll from="0" />} hint={t("kpi.refusalsHint", { count: p.returned })} />
          <GlassStat i={3} label={t("kpi.cash")} value={<MoneyText money={sum(h.cash.inTransit, h.cash.awaitingRemittance)} roll from="0" />}
            hint={t("kpi.cashHint", { transit: formatMoney(h.cash.inTransit, locale), held: formatMoney(h.cash.awaitingRemittance, locale) })} />
        </div>
      </Hero>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-3">
        <ProfitChart home={h} />
        <PaymentMix days={days} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-3">
        <ActivityLog />
        <Leaks leaks={h.leaks} />
      </div>
    </div>
  );
}

function sum(a: Money, b: Money): Money {
  const v = minor(a) + minor(b);
  return { amount: `${v < 0 ? "-" : ""}${Math.floor(Math.abs(v) / 100)}.${String(Math.abs(v) % 100).padStart(2, "0")}`, currency: a.currency };
}

/** Shades of the ink side for the costs, from the largest; what was kept is the one red. */
const SHADE = ["opacity-90", "opacity-70", "opacity-55", "opacity-40", "opacity-30", "opacity-20", "opacity-15"] as const;
const COSTS = ["productCost", "shippingAndCod", "ads", "returns", "team", "fees", "fixed"] as const;

/**
 * The scale: what was kept, large, on the ink side; under it one bar holding every pound of revenue,
 * its parts filling in turn (product, shipping, ads …) until what is left, the kept part, lands in
 * red. The legend under it carries the amounts and shares.
 */
function Hero({ home, updated, fetching, children }: { home: Home; updated: string; fetching: boolean; children: ReactNode }) {
  const t = useTranslations("profitHome");
  const tw = useTranslations("profitHome.where");
  const p = home.period;
  const b = p.breakdown;
  const revenue = minor(b.revenue);
  const share = (m: Money) => (revenue > 0 ? Math.min(100, Math.abs(minor(m)) / revenue * 100) : 0);
  const rows = COSTS.map((k, i) => ({ k, m: b[k], shade: SHADE[i]! })).filter((r) => minor(r.m) !== 0);
  const kept = b.kept;
  const loss = negative(kept);
  // FX-2 honesty rule (docs/16 §4.1): with a cost missing or nothing delivered the figure is
  // "Provisional profit" with "~" and a dashed underline, chips say what is missing, and no share
  // of revenue is shown for what was kept (a store with no costs would read 100%).
  const q = p.quality;
  const provisional = q.provisional;

  // The parts fill in turn (SETTLE, 90 ms apart: motion.css .mz-grow-x) the first time, and again
  // when the period changes (the key restarts them).
  const fillKey = `${home.from}|${home.to}|${revenue}`;

  return (
    <GlassRoot ink fields={false} className="g mz-enter overflow-hidden">
    <section className="text-rail-text" aria-labelledby="kept-title" data-testid="kept">
      <div className="relative isolate flex flex-col gap-6 overflow-hidden p-6 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="kept-title" className="text-body text-rail-text-2">{provisional ? t("kept.provisionalTitle", { days: home.days }) : t("kept.title", { days: home.days })}</h2>
          <p className="flex items-center gap-2 text-caption text-rail-text-2" aria-live="polite">
            {/* Live: a 10 px mono transfer while the figures refresh, the pair at rest otherwise (never red). */}
            <span className="inline-flex w-4 justify-center" aria-hidden="true">
              <Waiting meaning="syncing" size={16} still={!fetching} />
            </span>
            {t("live", { time: updated })}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
          <p className={`font-display text-display-lg leading-none tabular-nums ${loss ? "text-danger-text" : "text-white"}`} data-testid="kept-figure" data-provisional={provisional ? "" : undefined}>
            <MotionSurface surface="kpi" inline>
              {provisional
                ? <span className="mz-provisional mz-provisional--lg" title={t("provisional.hint")}><span aria-hidden="true">~</span><MoneyText money={p.kept} roll from="0" /></span>
                : <MoneyText money={p.kept} roll from="0" />}
            </MotionSurface>
          </p>
          {p.change !== null ? (
            <p className="pb-1 text-body-sm text-rail-text-2">
              <bdi dir="ltr" className={`me-1.5 rounded-full px-2 py-0.5 font-medium ${p.change.startsWith("-") ? "bg-danger-soft text-danger-text" : "bg-rail-surface text-rail-text"}`}>
                {t("kept.change", { pct: `${p.change.startsWith("-") ? "" : "+"}${p.change}` })}
              </bdi>
              {t("kept.vsPrev", { days: home.days })}
            </p>
          ) : null}
        </div>

        {provisional ? (
          <ul className="flex flex-wrap gap-2" data-testid="provisional-chips" aria-label={t("provisional.hint")}>
            {q.productsMissingCost > 0 ? (
              <li><Link href="/products?view=missing_cost" className="inline-flex min-h-6 items-center gap-1.5 rounded-full bg-rail-surface px-3 py-1 text-caption font-medium text-rail-text hover:underline pointer-coarse:min-h-11">
                <Icon name="warning" size={14} />{t("provisional.products", { count: q.productsMissingCost })}
              </Link></li>
            ) : q.ordersMissingCosts > 0 ? (
              <li><Link href="/settings/costs" className="inline-flex min-h-6 items-center gap-1.5 rounded-full bg-rail-surface px-3 py-1 text-caption font-medium text-rail-text hover:underline pointer-coarse:min-h-11">
                <Icon name="warning" size={14} />{t("provisional.orders", { count: q.ordersMissingCosts })}
              </Link></li>
            ) : null}
            {!q.delivered ? (
              <li className="inline-flex min-h-6 items-center gap-1.5 rounded-full bg-rail-surface px-3 py-1 text-caption text-rail-text-2">
                <Icon name="info" size={14} />{t("provisional.notDelivered")}
              </li>
            ) : null}
          </ul>
        ) : null}

        <div className="flex flex-col gap-1.5 text-body text-rail-text-2">
          {p.keptPer100 && q.costsComplete ? (
            <p>{t.rich("kept.per100", { hundred: () => <b className="text-rail-text"><MoneyText money={{ amount: "100.00", currency: home.baseCurrency }} /></b>, kept: () => <b className="text-rail-text"><MoneyText money={p.keptPer100!} /></b> })}</p>
          ) : !p.keptPer100 ? <p>{t("kept.noRevenue")}</p> : null}
          {p.expectedKept.amount !== p.kept.amount ? (
            <p className="text-body-sm" data-testid="expected">{t.rich("kept.expected", { money: () => <b className="text-rail-text"><MoneyText money={p.expectedKept} /></b> })}</p>
          ) : null}
        </div>
        {children}
      </div>

      <div className="flex flex-col gap-4 bg-rail-surface p-6 lg:p-8">
        <h3 className="flex flex-wrap items-baseline justify-between gap-2 text-body-sm">
          <span className="font-medium text-rail-text">{tw("title")}</span>
          <span className="text-rail-text-2">{tw("revenue")} <MoneyText money={b.revenue} /></span>
        </h3>
        <div key={fillKey} className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-rail-line" aria-hidden="true">
          {rows.map((r, i) => <span key={r.k} className={`mz-grow-x h-full bg-rail-text ${r.shade}`} style={{ inlineSize: `${share(r.m)}%`, animationDelay: `${120 + i * 90}ms` }} />)}
          {/* What the store kept is the money side: the view's one red when the budget gives it (else ink). */}
          {!loss && revenue > 0 ? <RedSwatch claim="kept" fallback="var(--mz-rail-text)" className="mz-grow-x h-full" style={{ inlineSize: `${share(kept)}%`, animationDelay: `${120 + rows.length * 90}ms` }} /> : null}
        </div>
        <ul className="mz-stagger grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4" data-testid="breakdown">
          {[...rows, { k: "kept" as const, m: kept, shade: "" }].map((r, i) => (
            <li key={r.k} className="flex min-w-0 flex-col gap-0.5" style={order(i)}>
              <span className="flex items-center gap-2 text-caption text-rail-text-2">
                {r.k === "kept" ? <RedSwatch claim="kept" fallback="var(--mz-rail-text)" className="size-2 shrink-0 rounded-full" /> : <span className={`size-2 shrink-0 rounded-full bg-rail-text ${r.shade}`} aria-hidden="true" />}
                <span className="truncate">{tw(r.k)}</span>
              </span>
              <span className={`text-body-sm font-medium tabular-nums ${r.k === "kept" && loss ? "text-danger-text" : "text-rail-text"}`}>
                <MoneyText money={r.m} />
              </span>
              {revenue > 0 && !(r.k === "kept" && provisional) ? <span className="text-caption text-rail-text-2">{tw("share", { pct: share(r.m).toFixed(1) })}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
    </GlassRoot>
  );
}

/** Leaks: what is costing money, or hiding it, with where to fix it. */
function Leaks({ leaks }: { leaks: Leak[] }) {
  const t = useTranslations("profitHome.leaks");
  return (
    <section className="mz-card flex flex-col gap-3 p-5" aria-labelledby="leaks-title" data-testid="leaks">
      <h2 id="leaks-title" className="text-heading-sm">{t("title")}</h2>
      {leaks.length === 0 ? <p className="text-body-sm text-text-2">{t("none")}</p> : (
        <ul className="mz-stagger flex flex-col divide-y divide-line">
          {leaks.map((l, i) => (
            <li key={l.kind} className="flex items-start gap-3 py-2.5" style={order(i)}>
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

/** A KPI as glass over the ink: the brand's light passes behind it. `meter` draws a share under the value. */
function GlassStat({ label, value, hint, meter = null, i }: { label: string; value: ReactNode; hint: ReactNode; meter?: number | null; i: number }) {
  return (
    <div className="mz-glass flex flex-col gap-1.5 p-4" style={order(i)}>
      <p className="text-caption text-rail-text-2">{label}</p>
      <p className="font-display text-kpi-sm leading-tight text-white tabular-nums">{value}</p>
      {meter !== null ? (
        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-rail-line" aria-hidden="true">
          <span className="mz-grow-x block h-full rounded-full bg-rail-text" style={{ inlineSize: `${Math.max(0, Math.min(100, meter))}%` }} />
        </span>
      ) : null}
      <p className="text-caption text-rail-text-2">{hint}</p>
    </div>
  );
}