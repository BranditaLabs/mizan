"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const METHODS = new Set(["cod", "card", "wallet", "apple_pay", "bnpl", "bank_transfer", "instapay", "fawry_ref", "store_credit", "cash_pos", "marketplace"]);
/** Ink shades from the largest share down; cash on delivery is never singled out by colour. */
const SHADES = ["stroke-text", "stroke-text-2", "stroke-text-3", "stroke-line-strong", "stroke-line"] as const;
const DOTS = ["bg-text", "bg-text-2", "bg-text-3", "bg-line-strong", "bg-line"] as const;
const R = 40;
const C = 2 * Math.PI * R;

/**
 * The payment mix (E14-6): how the period's orders were paid, as a ring whose arcs sweep in one after
 * another, the order count in its middle and the share per mode beside it; then the money that came
 * in by method. Links to the payments screen.
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
  const modes = [...mix.modes].sort((a, b) => b.orders - a.orders);
  // Each arc starts where the ones before it end.
  const lens = modes.map((m) => (m.orders / mix.orders) * C);
  const arcs = modes.map((m, i) => ({
    mode: m.mode, len: lens[i]!, offset: -lens.slice(0, i).reduce((a, b) => a + b, 0), shade: SHADES[Math.min(i, SHADES.length - 1)]!, i,
  }));

  return (
    <section className="mz-card flex flex-col gap-4 p-5" aria-labelledby="mix-title" data-testid="payment-mix">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="mix-title" className="text-heading-sm">{t("title", { days: mix.days })}</h2>
        <Link href="/payments" className="text-body-sm text-text-2 hover:underline">{t("open")}</Link>
      </div>
      <div className="grid items-center gap-5 sm:grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-1 2xl:grid-cols-[auto_minmax(0,1fr)]">
        <div className="relative mx-auto size-32 shrink-0">
          <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
            <circle cx="50" cy="50" r={R} fill="none" className="stroke-surface-sunk" strokeWidth="12" />
            {arcs.map((a) => (
              <circle key={a.mode} cx="50" cy="50" r={R} fill="none" className={`mz-arc ${a.shade}`} strokeWidth="12"
                strokeDasharray={`${Math.max(0, a.len - 1.2)} ${C}`} strokeDashoffset={a.offset}
                style={{ "--len": a.len, animationDelay: `${120 + a.i * 140}ms` } as CSSProperties} />
            ))}
          </svg>
          <p className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="font-display text-heading-md tabular-nums">{mix.orders}</span>
            <span className="text-caption text-text-3">{t("orders")}</span>
          </p>
        </div>
        <ul className="mz-stagger flex min-w-0 flex-col gap-2">
          {modes.map((m, i) => (
            <li key={m.mode} className="flex items-center justify-between gap-3 text-body-sm" style={{ "--i": i } as CSSProperties}>
              <span className="flex items-center gap-2 text-text-2">
                <span className={`size-2.5 rounded-full ${DOTS[Math.min(i, DOTS.length - 1)]}`} aria-hidden="true" />
                {tm(m.mode)}
              </span>
              <span className="text-end">{t.rich("share", { pct: m.pct, orders: m.orders, n: (c) => <bdi dir="ltr" className="mz-num">{c}</bdi> })}</span>
            </li>
          ))}
        </ul>
      </div>
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
