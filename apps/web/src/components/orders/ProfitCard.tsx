"use client";

import { COST_FLAGS, rolesWith } from "@mizan/shared";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { Pending } from "@/components/ui/QueryState";
import { Card, KeyValue } from "@/components/ui/Surface";
import { MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type Pnl = Schemas["OrderPnl"];
type Money = Pnl["net"];
const READERS = rolesWith("profit.read");
const COSTS = ["productCost", "shipping", "codFee", "paymentFee", "agent", "packaging", "returns", "chargebacks", "channelFee", "ads"] as const;
/** The order-profit flags that mean an input is missing: the API's own list (@mizan/shared), so the order and the period agree. */
const MISSING = COST_FLAGS;
const isZero = (m: Money) => Number(m.amount) === 0;
const negate = (m: Money): Money => ({ ...m, amount: m.amount.startsWith("-") ? m.amount.slice(1) : `-${m.amount}` });
const pct = (a: Money, b: Money) => (Number(b.amount) > 0 ? Math.round((Number(a.amount) / Number(b.amount)) * 1000) / 10 : null);

/**
 * One order's profit (M5, E9-2): what it makes if it delivers (still moving) or what it made,
 * every cost line, and what is missing so the number can be trusted (product cost, rates).
 */
export function ProfitCard({ orderId, moving }: { orderId: string; moving: boolean }) {
  const t = useTranslations("orders.profit");
  const { api, user, store } = useSession();
  const allowed = READERS.has(store?.role ?? "");
  const q = useQuery({
    queryKey: ["orderPnl", user?.uid ?? "", store?.tenantId ?? "", orderId],
    queryFn: () => ok(api.GET("/v1/orders/{id}/pnl", { params: { path: { id: orderId } } })),
    enabled: allowed,
    meta: { toast: false },
  });
  if (!allowed) return null;
  const p = q.data;
  if (!p) return <Card title={t("title")}><Pending query={q} compact><p className="text-body-sm text-text-3">{t("loading")}</p></Pending></Card>;

  const headline = moving ? p.expectedNet : p.net;
  const base = moving ? p.expectedRevenue : p.revenue;
  const missing = MISSING.filter((f) => p.flags.includes(f));
  // FX-2: with an input missing the figure is provisional ("~", dashed) and no margin is shown
  // (an order with no product cost would read as a 100% margin).
  const provisional = missing.length > 0;
  const margin = provisional ? null : pct(headline, base);
  const productMissing = p.flags.includes("cost_missing");
  const rows = [
    { label: t(moving ? "expectedRevenue" : "revenue"), value: <MoneyText money={moving ? p.expectedRevenue : p.revenue} /> },
    ...(isZero(p.refunds) || moving ? [] : [{ label: t("refunds"), value: <MoneyText money={negate(p.refunds)} /> }]),
    ...(productMissing && isZero(p.productCost) ? [{ label: t("costs.productCost"), value: <Badge tone="warning" dot={false}>{t("missingChip")}</Badge> }] : []),
    ...COSTS.filter((k) => !isZero(p[k])).map((k) => ({ label: t(`costs.${k}`), value: <MoneyText money={negate(p[k])} /> })),
  ];
  return (
    <Card title={t("title")} actions={<Badge tone={p.isFinal ? "success" : "neutral"} dot={false}>{t(p.isFinal ? "final" : "provisional")}</Badge>}>
      <div className="flex flex-col gap-3" data-testid="profit-card">
        <div>
          <p className="text-caption text-text-2">{provisional ? t("provisionalNet") : t(moving ? "expectedNet" : "net")}</p>
          <p className={`font-display text-heading-lg ${Number(headline.amount) < 0 ? "text-danger" : ""}`} data-provisional={provisional ? "" : undefined}>
            {provisional ? <span className="mz-provisional" title={t("provisionalHint")}><span aria-hidden="true">~</span><MoneyText money={headline} /></span> : <MoneyText money={headline} />}
          </p>
          {margin !== null ? <p className="text-caption text-text-2">{t.rich("margin", { pct: margin, n: (c) => <bdi dir="ltr" className="mz-num">{c}</bdi> })}</p> : null}
          {moving ? <p className="mt-1 text-caption text-text-3">{t("movingHint")}</p> : null}
        </div>
        <KeyValue items={rows} />
        {p.flags.includes("estimated") ? <p className="text-caption text-text-3">{t("estimated")}</p> : null}
        {missing.length ? (
          <div className="rounded-md border border-line p-3">
            <p className="text-body-sm font-medium">{t("missingTitle")}</p>
            <ul className="mt-1 list-disc ps-5 text-body-sm text-text-2">{missing.map((f) => <li key={f}>{t(`missing.${f}`)}</li>)}</ul>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {productMissing ? <Link href="/products?view=missing_cost" className="inline-flex min-h-6 items-center text-body-sm font-medium underline underline-offset-2 pointer-coarse:min-h-11">{t("setProductCosts")}</Link> : null}
              {missing.some((f) => f !== "cost_missing") ? <Link href="/settings/costs" className="inline-flex min-h-6 items-center text-body-sm font-medium underline underline-offset-2 pointer-coarse:min-h-11">{t("setCosts")}</Link> : null}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
