"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const METHODS = new Set(["cod", "card", "wallet", "apple_pay", "bnpl", "bank_transfer", "instapay", "fawry_ref", "store_credit", "cash_pos", "marketplace"]);

/**
 * The home's payment mix (E14-6): how the period's orders were paid (share of orders per mode),
 * and the money that came in by method. Links to the payments screen.
 */
export function PaymentMix({ days }: { days: 7 | 30 | 90 }) {
  const t = useTranslations("paymentsScreen.mix");
  const tm = useTranslations("payments.mode");
  const td = useTranslations("orders.detail.method");
  const { api, user, store } = useSession();
  const q = useQuery({
    queryKey: ["paymentMix", user?.uid ?? "", store?.tenantId ?? "", days],
    queryFn: () => ok(api.GET("/v1/payments/mix", { params: { query: { days } } })),
    enabled: Boolean(store),
    placeholderData: (prev) => prev,
    meta: { toast: false },
  });
  const mix = q.data;
  if (!mix || mix.orders === 0) return null;
  return (
    <section className="mz-card flex flex-col gap-4 p-5" aria-labelledby="mix-title" data-testid="payment-mix">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="mix-title" className="text-heading-sm">{t("title", { days: mix.days })}</h2>
        <Link href="/payments" className="text-body-sm text-text-2 hover:underline">{t("open")}</Link>
      </div>
      <ul className="flex flex-col gap-2">
        {mix.modes.map((m) => (
          <li key={m.mode} className="grid grid-cols-[minmax(7rem,11rem)_1fr_minmax(7rem,auto)] items-center gap-3 text-body-sm">
            <span className="text-text-2">{tm(m.mode)}</span>
            <span className="h-2 rounded-full bg-surface-sunk" aria-hidden="true">
              <span className="block h-2 rounded-full bg-text-3" style={{ inlineSize: `${m.pct}%` }} />
            </span>
            <span className="text-end">{t.rich("share", { pct: m.pct, orders: m.orders, n: (c) => <bdi dir="ltr" className="mz-num">{c}</bdi> })}</span>
          </li>
        ))}
      </ul>
      {mix.received.length ? (
        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          <h3 className="text-body-sm font-medium">{t("received")}</h3>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-body-sm">
            {mix.received.map((r) => (
              <li key={`${r.method}-${r.amount.currency}`}><span className="text-text-2">{METHODS.has(r.method) ? td(r.method as "cod") : r.method}</span>{" "}<MoneyText money={r.amount} /></li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
