"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmationCard } from "@/components/orders/ConfirmationCard";
import { CustomerCard } from "@/components/orders/OrderDetail";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { Card, EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { MoneyText } from "@/components/ui/Values";
import { Bdi } from "@/components/Bdi";
import { Link } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { formatWhen } from "@/lib/format";
import { useSession } from "@/lib/session";

const CALLERS = new Set(["owner", "admin", "ops_manager", "agent"]);

/**
 * The team's call queue (M2, E6-3): how many orders wait for a call, then one order at a time —
 * what to say (the script), the customer's phone behind an audited "show" with tap-to-call, and
 * the outcome buttons (confirmed, cancelled, no answer → it comes back at the retry time). "Next"
 * claims the next order for this caller, so two people never call the same customer.
 */
export function CallQueue() {
  const t = useTranslations("callQueue");
  const locale = useLocale();
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const allowed = CALLERS.has(store?.role ?? "");
  const [current, setCurrent] = useState<{ id: string; number: string; attempts: number; unreachable: boolean } | null>(null);
  const [emptyAfterNext, setEmptyAfterNext] = useState(false);
  const scope = [user?.uid ?? "", store?.tenantId ?? ""];
  const queue = useQuery({ queryKey: ["callQueue", ...scope], queryFn: () => ok(api.GET("/v1/confirmation/queue")), enabled: Boolean(store) && allowed, refetchInterval: 30_000 });
  const next = useMutation({
    mutationFn: () => ok(api.POST("/v1/confirmation/queue/next")),
    onSuccess: (r) => { setCurrent(r.order); setEmptyAfterNext(r.order === null); void qc.invalidateQueries({ queryKey: ["callQueue"] }); },
  });
  const order = useQuery({
    queryKey: ["order", ...scope, current?.id ?? ""],
    queryFn: () => ok(api.GET("/v1/orders/{id}", { params: { path: { id: current!.id } } })),
    enabled: Boolean(current),
  });

  const frame = (body: React.ReactNode) => (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="call-queue">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg">{t("title")}</h1>
          <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
        </div>
        {allowed ? <Button icon="call" busy={next.isPending} onClick={() => next.mutate()}>{current ? t("next") : t("start")}</Button> : null}
      </header>
      {body}
    </div>
  );
  if (!allowed) return frame(<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>);

  const q = queue.data;
  const o = order.data;
  return frame(
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="queue-counts">
        <StatCard label={t("waiting")} value={q?.waiting ?? "…"} />
        <StatCard label={t("mine")} value={q?.mine ?? "…"} />
        <StatCard label={t("later")} value={q?.later ?? "…"} period={q?.nextAt ? t("nextAt", { at: formatWhen(q.nextAt, locale) }) : undefined} />
        <StatCard label={t("unreachable")} value={q?.unreachable ?? "…"} />
      </div>

      {!current ? (
        <div className="mz-card">
          <EmptyState icon="call" title={emptyAfterNext ? t("empty.title") : t("ready.title")} body={emptyAfterNext ? t("empty.body") : t("ready.body")} />
        </div>
      ) : order.isPending ? (
        <div className="mz-card"><SkeletonRows rows={5} label={t("loading")} /></div>
      ) : o ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]" data-testid="call-order">
          <div className="flex flex-col gap-5">
            <Card title={<span className="flex flex-wrap items-center gap-2"><Link href={`/orders/${o.id}`} className="hover:underline"><Bdi code>{o.number}</Bdi></Link>
              {current.attempts > 0 ? <Badge tone="warning">{t("attempt", { n: current.attempts + 1 })}</Badge> : null}
              {current.unreachable ? <Badge tone="danger">{t("unreachableBadge")}</Badge> : null}</span>}>
              <ul className="flex flex-col gap-1 text-body-sm">
                {o.lines.map((l) => <li key={l.id} className="flex justify-between gap-3"><span>{l.title}</span><span className="text-text-2"><bdi>{t("qty", { n: l.quantity })}</bdi></span></li>)}
              </ul>
              <dl className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-body-sm">
                <div className="flex justify-between gap-3"><dt className="text-text-2">{t("total")}</dt><dd><MoneyText money={o.total} /></dd></div>
                <div className="flex justify-between gap-3 font-semibold"><dt>{t("collect")}</dt><dd><MoneyText money={o.cod} /></dd></div>
                {o.area.city ? <div className="flex justify-between gap-3"><dt className="text-text-2">{t("area")}</dt><dd>{o.area.city}</dd></div> : null}
              </dl>
            </Card>
            <CustomerCard order={o} />
          </div>
          <ConfirmationCard orderId={o.id} orderStatus={o.status} />
        </div>
      ) : null}
    </>,
  );
}
