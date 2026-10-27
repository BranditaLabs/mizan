"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IdCell } from "@/components/ui/DataTable";
import { Card } from "@/components/ui/Surface";
import { MoneyText } from "@/components/ui/Values";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type Order = Schemas["OrderDetail"];
type Shipment = Order["shipments"][number];
const SHIPPERS = new Set(["owner", "admin", "ops_manager", "warehouse"]);
const ERRORS = new Set(["city_unknown", "address_invalid", "payment_blocks", "cancelled", "not_found", "courier_refused_key", "courier_failed"]);
const STATUSES = new Set(["created", "pickup_requested", "picked_up", "in_transit", "out_for_delivery", "failed_attempt", "delivered", "returning", "returned", "cancelled", "lost", "unknown"]);
const providerName = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const isLive = (s: Shipment) => s.booking !== "failed" && s.status !== "cancelled";

/**
 * The order's shipping (M3, E7-1): a confirmed order is handed to the courier with one tap; the
 * booking shows while the courier answers, then the tracking number, or why it failed (and the
 * team tries again once fixed). The order screen polls while a booking is pending.
 */
export function ShippingCard({ order: o }: { order: Order }) {
  const t = useTranslations("shipping");
  const { api, store } = useSession();
  const qc = useQueryClient();
  const canShip = SHIPPERS.has(store?.role ?? "");
  const live = o.shipments.find(isLive);
  const ship = useMutation({
    mutationFn: () => ok(api.POST("/v1/orders/{id}/ship", { params: { path: { id: o.id } } })),
    onSettled: () => qc.invalidateQueries({ queryKey: ["order"] }),
  });
  const offer = canShip && o.status === "confirmed" && !live;
  if (!o.shipments.length && !offer) return null;
  return (
    <Card title={t("title")} actions={offer ? (
      <Button size="sm" icon="shipping" busy={ship.isPending} onClick={() => ship.mutate()}>{o.shipments.length ? t("again") : t("ship")}</Button>
    ) : null}>
      <div className="flex flex-col gap-3" data-testid="shipping">
        {!o.shipments.length ? <p className="text-body-sm text-text-2">{t("ready")}</p> : null}
        <ul className="flex flex-col divide-y divide-line">
          {o.shipments.map((s) => (
            <li key={s.id} className="flex flex-col gap-1.5 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="font-medium">{providerName(s.provider)}</span>
                  {s.trackingNumber ? <IdCell>{s.trackingNumber}</IdCell> : null}
                </span>
                {s.booking === "pending" ? <Badge tone="info">{t("booking.pending")}</Badge>
                  : s.booking === "failed" ? <Badge tone="danger">{t("booking.failed")}</Badge>
                  : <Badge tone={s.status === "delivered" ? "success" : s.status === "returned" || s.status === "lost" ? "danger" : "neutral"}>{STATUSES.has(s.status) ? t(`status.${s.status as "created"}`) : s.status}</Badge>}
              </div>
              {s.booking === "failed" && s.errorCode ? (
                <Alert tone="danger">{ERRORS.has(s.errorCode) ? t(`error.${s.errorCode as "city_unknown"}`) : t("error.courier_failed")}</Alert>
              ) : (
                <p className="text-body-sm text-text-2">
                  {Number(s.cod.amount) > 0 ? t.rich("cod", { m: () => <MoneyText money={s.cod} /> }) : t("noCod")}
                  {s.trackingUrl && s.trackingNumber ? <>{" · "}<a href={s.trackingUrl} target="_blank" rel="noreferrer" className="underline">{t("track")}</a></> : null}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
