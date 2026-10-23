"use client";

import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button, ButtonGroup } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Card } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { DateText } from "@/components/ui/Values";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type Summary = Schemas["OrderConfirmation"];
type RunStatus = NonNullable<Summary["run"]>["status"];
const TONE: Record<RunStatus, BadgeTone> = { running: "info", needs_agent: "warning", confirmed: "success", cancelled: "neutral", stopped: "neutral" };
const CHANNEL_ICON: Record<string, IconProps["name"]> = { whatsapp: "message", sms: "sms", voice: "call", agent: "customer" };
const CAN_ACT = new Set(["owner", "admin", "ops_manager", "agent"]);

/**
 * The order's confirmation (M2, E6-7): where the automatic cascade stands, what was sent, and the
 * hand-off tools: send the confirm link on WhatsApp (wa.me, no vendor needed), copy it, or record
 * the customer's answer after a call.
 */
export function ConfirmationCard({ orderId, orderStatus }: { orderId: string; orderStatus: string }) {
  const t = useTranslations("orders.confirmation");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [cancelOpen, setCancelOpen] = useState(false);
  const allowed = CAN_ACT.has(store?.role ?? "");
  const key = ["orderConfirmation", user?.uid ?? "", store?.tenantId ?? "", orderId];
  const summary = useQuery({ queryKey: key, queryFn: () => ok(api.GET("/v1/orders/{id}/confirmation", { params: { path: { id: orderId } } })), enabled: allowed, meta: { toast: false } });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["orderConfirmation"] }); void qc.invalidateQueries({ queryKey: ["order"] }); void qc.invalidateQueries({ queryKey: ["orders"] }); };

  const link = useMutation({ mutationFn: () => ok(api.POST("/v1/orders/{id}/confirmation/link", { params: { path: { id: orderId } } })), onSuccess: refresh });
  const answer = useMutation({
    mutationFn: (a: "confirm" | "cancel") => ok(api.POST("/v1/orders/{id}/confirmation", { params: { path: { id: orderId } }, body: a === "cancel" ? { answer: a, reason: "other" } : { answer: a } })),
    onSuccess: (_r, a) => { setCancelOpen(false); toast({ message: t(a === "confirm" ? "confirmedToast" : "cancelledToast") }); refresh(); },
  });

  if (!allowed) return null;
  const open = orderStatus === "new" || orderStatus === "pending_confirmation";

  const sendWhatsApp = async () => {
    // Opened before the request, so the browser treats it as the click's own window (no pop-up block).
    const w = window.open("", "_blank");
    try {
      const r = await link.mutateAsync();
      if (w && r.whatsappUrl) { w.opener = null; w.location.href = r.whatsappUrl; } else { w?.close(); toast({ message: t("noPhone") }); }
    } catch { w?.close(); }
  };
  const copyLink = async () => {
    const r = await link.mutateAsync();
    try { await navigator.clipboard.writeText(r.url); toast({ message: t("copied") }); } catch { toast({ message: r.url }); }
  };

  const s = summary.data;
  const run = s?.run ?? null;
  return (
    <Card title={t("title")} actions={run ? <Badge tone={TONE[run.status]}>{t(`status.${run.status}`)}</Badge> : null}>
      <div className="flex flex-col gap-3" data-testid="confirmation-card">
        {!s ? <p className="text-body-sm text-text-3">{t("loading")}</p> : !run ? (
          <p className="text-body-sm text-text-2">{t("none")}</p>
        ) : (
          <>
            {run.status === "needs_agent" ? <p className="text-body-sm">{t(`reason.${(run.reason ?? "no_reply") as "no_reply"}`)}</p> : null}
            {run.next && run.status === "running" ? (
              <p className="text-body-sm text-text-2">{t(run.next.kind === "send" ? "nextSend" : "waiting", { channel: t(`channel.${run.next.channel as "sms"}`) })}{" "}<DateText relative value={run.next.at} /></p>
            ) : null}
            {s.steps.length ? (
              <ol className="flex flex-col gap-1.5">
                {s.steps.map((st) => (
                  <li key={st.idx} className="flex items-center gap-2 text-body-sm">
                    <Icon name={CHANNEL_ICON[st.channel] ?? "message"} size={16} />
                    <span>{t(`channel.${st.channel as "sms"}`)}</span>
                    <span className="text-text-3">{" · "}{t(`stepStatus.${st.status as "done"}`)}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </>
        )}
        {s && !s.channels.whatsapp && !s.channels.sms && !s.channels.voice ? <p className="text-caption text-text-3">{t("noVendor")}</p> : null}
        {open ? (
          <ButtonGroup>
            <Button size="sm" icon="message" busy={link.isPending} onClick={() => void sendWhatsApp()}>{t("sendWhatsApp")}</Button>
            <Button size="sm" variant="secondary" icon="copy" busy={link.isPending} onClick={() => void copyLink()}>{t("copyLink")}</Button>
          </ButtonGroup>
        ) : null}
        {open ? (
          <ButtonGroup>
            <Button size="sm" variant="secondary" icon="confirm" busy={answer.isPending && answer.variables === "confirm"} onClick={() => answer.mutate("confirm")}>{t("markConfirmed")}</Button>
            <Button size="sm" variant="ghost" icon="close" onClick={() => setCancelOpen(true)}>{t("markCancelled")}</Button>
          </ButtonGroup>
        ) : null}
      </div>
      <ConfirmDialog open={cancelOpen} onClose={() => setCancelOpen(false)} onConfirm={() => answer.mutate("cancel")} busy={answer.isPending}
        title={t("cancelTitle")} description={t("cancelBody")} confirmLabel={t("markCancelled")} />
    </Card>
  );
}
