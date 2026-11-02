"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { Card, KeyValue } from "@/components/ui/Surface";
import { MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type Pnl = Schemas["OrderPnl"];
type Money = Pnl["net"];
const READERS = new Set(["owner", "admin", "finance", "ops_manager"]);
const COSTS = ["productCost", "shipping", "codFee", "paymentFee", "agent", "packaging", "returns", "chargebacks", "channelFee", "ads"] as const;
const MISSING = ["fx_missing", "cost_missing", "shipping_rate_missing", "return_rate_missing", "cod_fee_missing", "payment_fee_missing", "agent_cost_missing", "packaging_cost_missing"] as const;
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
  if (!p) return <Card title={t("title")}><p className="text-body-sm text-text-3">{q.isError ? t("failed") : t("loading")}</p></Card>;

  const headline = moving ? p.expectedNet : p.net;
  const base = moving ? p.expectedRevenue : p.revenue;
  const margin = pct(headline, base);
  const missing = MISSING.filter((f) => p.flags.includes(f));
  const rows = [
    { label: t(moving ? "expectedRevenue" : "revenue"), value: <MoneyText money={moving ? p.expectedRevenue : p.revenue} /> },
    ...(isZero(p.refunds) || moving ? [] : [{ label: t("refunds"), value: <MoneyText money={negate(p.refunds)} /> }]),
    ...COSTS.filter((k) => !isZero(p[k])).map((k) => ({ label: t(`costs.${k}`), value: <MoneyText money={negate(p[k])} /> })),
  ];
  return (
    <Card title={t("title")} actions={<Badge tone={p.isFinal ? "success" : "neutral"} dot={false}>{t(p.isFinal ? "final" : "provisional")}</Badge>}>
      <div className="flex flex-col gap-3" data-testid="profit-card">
        <div>
          <p className="text-caption text-text-2">{t(moving ? "expectedNet" : "net")}</p>
          <p className={`font-display text-heading-lg ${Number(headline.amount) < 0 ? "text-danger" : ""}`}><MoneyText money={headline} /></p>
          {margin !== null ? <p className="text-caption text-text-2">{t.rich("margin", { pct: margin, n: (c) => <bdi dir="ltr" className="mz-num">{c}</bdi> })}</p> : null}
          {moving ? <p className="mt-1 text-caption text-text-3">{t("movingHint")}</p> : null}
        </div>
        <KeyValue items={rows} />
        {p.flags.includes("estimated") ? <p className="text-caption text-text-3">{t("estimated")}</p> : null}
        {missing.length ? (
          <div className="rounded-md border border-line p-3">
            <p className="text-body-sm font-medium">{t("missingTitle")}</p>
            <ul className="mt-1 list-disc ps-5 text-body-sm text-text-2">{missing.map((f) => <li key={f}>{t(`missing.${f}`)}</li>)}</ul>
            <Link href="/settings/costs" className="mt-2 inline-block text-body-sm font-medium underline underline-offset-2">{t("setCosts")}</Link>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
