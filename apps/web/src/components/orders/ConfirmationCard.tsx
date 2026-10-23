"use client";

import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button, ButtonGroup } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Card } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { DateText, MoneyText } from "@/components/ui/Values";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type Summary = Schemas["OrderConfirmation"];
type RunStatus = NonNullable<Summary["run"]>["status"];
type ChatLine = Summary["whatsapp"][number];
const TONE: Record<RunStatus, BadgeTone> = { running: "info", needs_agent: "warning", confirmed: "success", cancelled: "neutral", stopped: "neutral" };
const CHANNEL_ICON: Record<string, IconProps["name"]> = { whatsapp: "message", call_auto: "call", voice: "call", call_team: "customer", sms: "sms", agent: "customer" };
const REASONS = ["team_call", "no_reply", "no_channel", "change_requested", "customer_message", "unreachable", "manual"] as const;
const OUT = new Set(["ask", "confirmed", "confirmed_offer", "offer_added", "offer_declined", "offer_expired", "change_prompt", "change_received", "cancel_reasons", "cancelled", "noted", "already"]);
const IN = new Set(["confirm", "change", "cancel", "reason", "keep", "note", "message", "location", "late", "ignored", "offer_yes", "offer_no"]);
const OFFER_TONE: Record<string, BadgeTone> = { proposed: "info", accepted: "success", applying: "info", applied: "success", declined: "neutral", expired: "neutral", failed: "danger" };
const CAN_ACT = new Set(["owner", "admin", "ops_manager", "agent"]);

/**
 * The order's confirmation (M2, E6-7, E6-10): where the cascade stands; the WhatsApp conversation
 * (what was sent and read, what the customer tapped, never the text); for the team, the call
 * script and the call's outcome (confirmed, cancelled, no answer). When the store has no WhatsApp
 * number connected, the confirm link can still be sent by hand (wa.me) or copied.
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
    mutationFn: (a: "confirm" | "cancel") => ok(api.POST("/v1/orders/{id}/confirmation", { params: { path: { id: orderId } }, body: { answer: a, byCall: true, ...(a === "cancel" ? { reason: "other" as const } : {}) } })),
    onSuccess: (_r, a) => { setCancelOpen(false); toast({ message: t(a === "confirm" ? "confirmedToast" : "cancelledToast") }); refresh(); },
  });
  const offerDecision = useMutation({
    mutationFn: (decision: "accept" | "decline") => ok(api.POST("/v1/orders/{id}/offer", { params: { path: { id: orderId } }, body: { decision } })),
    onSuccess: (r) => { toast({ message: t(`offer.toast.${r.status}`) }); refresh(); },
  });
  const noAnswer = useMutation({
    mutationFn: () => ok(api.POST("/v1/orders/{id}/confirmation/no-answer", { params: { path: { id: orderId } } })),
    onSuccess: (r) => { toast({ message: r.unreachable ? t("calls.unreachableToast") : t("calls.retryToast") }); refresh(); },
  });

  if (!allowed) return null;
  const open = orderStatus === "new" || orderStatus === "pending_confirmation" || orderStatus === "confirmed";
  const unanswered = orderStatus === "new" || orderStatus === "pending_confirmation";

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
  const reason = run?.reason && (REASONS as readonly string[]).includes(run.reason) ? (run.reason as (typeof REASONS)[number]) : "no_reply";
  const calling = unanswered && run?.status === "needs_agent";
  return (
    <Card title={t("title")} actions={run ? <Badge tone={TONE[run.status]}>{t(`status.${run.status}`)}</Badge> : null}>
      <div className="flex flex-col gap-4" data-testid="confirmation-card">
        {!s ? <p className="text-body-sm text-text-3">{t("loading")}</p> : !run ? (
          <p className="text-body-sm text-text-2">{t("none")}</p>
        ) : (
          <>
            {run.status === "needs_agent" ? <p className="text-body-sm">{t(`reason.${reason}`)}</p> : null}
            {run.next && run.status === "running" ? (
              <p className="text-body-sm text-text-2">{t(run.next.kind === "send" ? "nextSend" : "waiting", { channel: t(`channel.${channelKey(run.next.channel)}`) })}{" "}<DateText relative value={run.next.at} /></p>
            ) : null}
            {s.steps.length ? (
              <ol className="flex flex-col gap-1.5">
                {s.steps.map((st) => (
                  <li key={st.idx} className="flex items-center gap-2 text-body-sm">
                    <Icon name={CHANNEL_ICON[st.channel] ?? "message"} size={16} />
                    <span>{t(`channel.${channelKey(st.channel)}`)}</span>
                    <span className="text-text-3">{" · "}{t(`stepStatus.${st.status as "done"}`)}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </>
        )}

        {s && s.whatsapp.length ? (
          <section aria-label={t("chat.title")} className="flex flex-col gap-1.5" data-testid="confirmation-chat">
            <h3 className="text-caption font-medium text-text-2">{t("chat.title")}</h3>
            <ol className="flex flex-col gap-1.5">
              {s.whatsapp.map((m, i) => <ChatRow key={i} m={m} />)}
            </ol>
          </section>
        ) : null}

        {s?.offer ? (
          <section aria-label={t("offer.title")} className="flex flex-col gap-2 rounded-md border border-line p-3" data-testid="offer-box">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{t("offer.title")}</h3>
              <Badge tone={OFFER_TONE[s.offer.status] ?? "neutral"}>{t(`offer.status.${s.offer.status}`)}</Badge>
              <span className="ms-auto text-caption text-text-3">{t(`offer.source.${s.offer.source}`)}</span>
            </div>
            <p className="text-body-sm">
              {s.offer.title}{s.offer.qty > 1 ? <>{" "}{t.rich("offer.qty", { qty: s.offer.qty, n: (c) => <bdi className="mz-num">{c}</bdi> })}</> : null}{" · "}<MoneyText money={s.offer.offerPrice} />
              {s.offer.offerPrice.amount !== s.offer.unitPrice.amount ? <>{" "}<s className="text-text-3"><MoneyText money={s.offer.unitPrice} /></s></> : null}
            </p>
            {s.offer.status === "proposed" && open ? (
              <ButtonGroup>
                <Button size="sm" variant="secondary" icon="add" busy={offerDecision.isPending && offerDecision.variables === "accept"} onClick={() => offerDecision.mutate("accept")}>{t("offer.accept")}</Button>
                <Button size="sm" variant="ghost" busy={offerDecision.isPending && offerDecision.variables === "decline"} onClick={() => offerDecision.mutate("decline")}>{t("offer.decline")}</Button>
              </ButtonGroup>
            ) : null}
            {s.offer.status === "accepted" || s.offer.status === "applying" || s.offer.status === "applied" ? (
              <p className="text-caption text-text-2">{t(s.offer.status === "applied" ? "offer.appliedHint" : s.offer.status === "applying" ? "offer.applyingHint" : "offer.acceptedHint")}</p>
            ) : null}
            {s.offer.status === "failed" ? <Alert tone="warning">{t(`offer.failed.${s.offer.failure ?? "failed"}`)}</Alert> : null}
          </section>
        ) : null}

        {calling && s ? (
          <section aria-label={t("calls.title")} className="flex flex-col gap-3 rounded-md border border-line p-3" data-testid="call-panel">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-medium">{t("calls.title")}</h3>
              {run && run.calls.attempts > 0 ? (
                <span className="text-caption text-text-2">{t("calls.tried", { attempts: run.calls.attempts, max: run.calls.max })}</span>
              ) : null}
            </div>
            {s.script.length ? (
              <ol className="flex list-decimal flex-col gap-1 ps-5 text-body-sm" data-testid="call-script">
                {s.script.map((line, i) => <li key={i}>{line}</li>)}
              </ol>
            ) : null}
            <p className="text-caption text-text-3">{t("calls.phoneHint")}</p>
            {run?.calls.after ? <p className="text-caption text-text-2">{t("calls.after")}{" "}<DateText relative value={run.calls.after} /></p> : null}
            <ButtonGroup>
              <Button size="sm" icon="confirm" busy={answer.isPending && answer.variables === "confirm"} onClick={() => answer.mutate("confirm")}>{t("calls.confirmed")}</Button>
              <Button size="sm" variant="secondary" icon="call" busy={noAnswer.isPending} onClick={() => noAnswer.mutate()}>{t("calls.noAnswer")}</Button>
              <Button size="sm" variant="ghost" icon="close" onClick={() => setCancelOpen(true)}>{t("calls.cancelled")}</Button>
            </ButtonGroup>
          </section>
        ) : null}

        {s && !s.channels.whatsapp ? <p className="text-caption text-text-3">{t("noVendor")}</p> : null}
        {unanswered && s && !s.channels.whatsapp ? (
          <ButtonGroup>
            <Button size="sm" variant="secondary" icon="message" busy={link.isPending} onClick={() => void sendWhatsApp()}>{t("sendWhatsApp")}</Button>
            <Button size="sm" variant="ghost" icon="copy" busy={link.isPending} onClick={() => void copyLink()}>{t("copyLink")}</Button>
          </ButtonGroup>
        ) : null}
        {unanswered && !calling ? (
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

/** Steps stored before E6-10 say "voice"; they read as the automated call. */
function channelKey(channel: string): "whatsapp" | "call_auto" | "call_team" | "sms" | "agent" {
  if (channel === "voice") return "call_auto";
  return (["whatsapp", "call_auto", "call_team", "sms", "agent"] as const).find((c) => c === channel) ?? "agent";
}

/** One line of the WhatsApp conversation: what it was, and how far it got. */
function ChatRow({ m }: { m: ChatLine }) {
  const t = useTranslations("orders.confirmation.chat");
  const out = m.direction === "out";
  const action = m.action ?? "";
  const label = out ? (OUT.has(action) ? t(`out.${action as "ask"}`) : t("out.other")) : IN.has(action) ? t(`in.${action as "confirm"}`) : t("in.ignored");
  return (
    <li className="flex items-center gap-2 text-body-sm">
      <Icon name={out ? "message" : "customer"} size={16} />
      <span>{label}</span>
      {out ? <span className="text-text-3">{" · "}{t(`status.${(["accepted", "sent", "delivered", "read", "failed"].includes(m.status) ? m.status : "sent") as "sent"}`)}</span> : null}
      <span className="ms-auto text-caption text-text-3"><DateText relative value={m.at} /></span>
    </li>
  );
}
