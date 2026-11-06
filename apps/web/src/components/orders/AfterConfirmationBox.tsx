"use client";

import { can } from "@mizan/shared";
import { Icon } from "@mizan/design-system/icons/react";
import { useMutation } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Button, ButtonGroup } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { formatWhen } from "@/lib/format";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession, useTimeZone } from "@/lib/session";

type After = Schemas["OrderConfirmation"]["after"];
/** Refusals a retry cannot clear: only the team decides (book by hand, or fix the order and release). */
const FINAL = new Set(["payment_mode_not_allowed", "duplicate_suspected"]);
const WHY = new Set(["payment_blocks_shipping", "payment_mode_not_allowed", "address_missing", "no_courier", "courier_needs_attention", "store_not_connected", "stock_short", "stock_settling", "duplicate_suspected", "offer_settling", "order_moved"]);

/**
 * What happens to this order after confirmation (E6-23a), on the order's confirmation card: the
 * change window or a hold because the customer wrote, when it goes to packing or books by itself,
 * why an automatic booking stopped, and a scheduled cancel. The team can release it now or book it by hand.
 */
export function AfterConfirmationBox({ orderId, after, onChange }: { orderId: string; after: After; onChange(): void }) {
  const t = useTranslations("orders.confirmation.after");
  const tw = useTranslations("notifications.after.why");
  const { api, store } = useSession();
  const locale = useLocale();
  const timeZone = useTimeZone();
  const toast = useToast();
  const mayAct = can(store?.role, "shipping.ship");
  const release = useMutation({
    mutationFn: () => ok(api.POST("/v1/orders/{id}/after-confirmation/release", { params: { path: { id: orderId } } })),
    onSuccess: () => { toast({ message: t(retrying ? "retriedToast" : "releasedToast") }); onChange(); },
  });
  const skip = useMutation({
    mutationFn: () => ok(api.POST("/v1/orders/{id}/after-confirmation/skip", { params: { path: { id: orderId } } })),
    onSuccess: () => { toast({ message: t("skippedToast") }); onChange(); },
  });

  if (!after) return null; // an API from before E6-23a: nothing to show, never a broken card
  const rel = after.followups.find((f) => f.kind === "release");
  const cancel = after.followups.find((f) => f.kind === "no_answer_cancel");
  // "Sat 10:30 AM" in the store's time: these are minutes away, the hour is what matters.
  const time = (at: string) => function When() { return <time dateTime={at}><bdi dir="ltr">{formatWhen(at, locale, "latn", timeZone)}</bdi></time>; };
  const lines: Array<{ icon: Parameters<typeof Icon>[0]["name"]; text: React.ReactNode; tone?: "warning" }> = [];
  if (after.holdReason === "customer_message") lines.push({ icon: "message", text: t("heldByCustomer"), tone: "warning" });
  else if (after.heldUntil) lines.push({ icon: "pending", text: t.rich("held", { t: time(after.heldUntil) }) });
  if (rel?.status === "pending") lines.push({ icon: rel.autoBook ? "shipping" : "unboxed", text: t.rich(rel.autoBook ? "books" : "releases", { t: time(rel.at) }) });
  if (rel?.status === "done" && rel.result === "ready") lines.push({ icon: "shipping", text: t("ready") });
  if (rel?.result === "by_team") lines.push({ icon: "customer", text: t("byTeam") });
  const stopped = rel && rel.autoBook && ((rel.status === "blocked" && rel.result && rel.result !== "customer_message") || (rel.status === "done" && rel.result === "offer_settling"));
  if (stopped && rel.result) {
    lines.push({ icon: "warning", tone: "warning", text: t("blocked", { why: WHY.has(rel.result) ? tw(rel.result as "no_courier") : tw("other") }) });
  }
  if (cancel?.status === "pending") lines.push({ icon: "refused", text: t.rich("autoCancel", { t: time(cancel.at) }) });
  if (cancel?.status === "done" && cancel.result === "cancelled") lines.push({ icon: "refused", text: t("autoCancelled") });
  if (!lines.length) return null;

  const held = Boolean(after.heldUntil) || after.holdReason === "customer_message";
  const waiting = rel && (rel.status === "pending" || rel.status === "blocked");
  const retrying = !held && rel?.status === "blocked" && Boolean(rel.result) && !FINAL.has(rel.result ?? "");
  return (
    <section aria-label={t("title")} className="flex flex-col gap-2 rounded-md border border-line p-3" data-testid="after-confirmation">
      <h3 className="text-caption font-medium text-text-2">{t("title")}</h3>
      <ul className="flex flex-col gap-1.5">
        {lines.map((l, i) => (
          <li key={i} className={`flex items-start gap-2 text-body-sm ${l.tone === "warning" ? "text-warning" : ""}`}>
            <Icon name={l.icon} size={16} className="mt-0.5 shrink-0" />
            <span>{l.text}</span>
          </li>
        ))}
      </ul>
      {mayAct && (held || waiting || stopped) ? (
        <ButtonGroup>
          {held || retrying ? <Button size="sm" variant="secondary" busy={release.isPending} onClick={() => release.mutate()}>{t(held ? "release" : "retry")}</Button> : null}
          {rel?.autoBook && (waiting || stopped) ? <Button size="sm" variant="ghost" busy={skip.isPending} onClick={() => skip.mutate()}>{t("skip")}</Button> : null}
        </ButtonGroup>
      ) : null}
    </section>
  );
}
