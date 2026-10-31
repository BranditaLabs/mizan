"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Select, TextArea } from "@/components/ui/Field";
import { SkeletonRows } from "@/components/ui/Surface";
import { MoneyText } from "@/components/ui/Values";
import { apiClient, ApiError, ok, type Schemas } from "@/lib/api/client";

type View = Schemas["PublicConfirmation"];
type Answer = Schemas["PublicAnswer"];
type Reason = NonNullable<Answer["reason"]>;
const REASONS: readonly Reason[] = ["changed_mind", "ordered_by_mistake", "found_cheaper", "delivery_too_late", "other"];

/**
 * The customer's confirm page (M2, E6-7), opened from an SMS, a WhatsApp message or a link an
 * agent sent. No sign-in: the link is the key. One tap confirms; change and cancel ask one more
 * thing. Sharing the location is optional and asked by the browser first.
 */
export function ConfirmPage({ token }: { token: string }) {
  const t = useTranslations("confirm");
  const locale = useLocale();
  const api = useMemo(() => apiClient({ user: null, locale }), [locale]);
  const [mode, setMode] = useState<"main" | "change" | "cancel">("main");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<Reason>("changed_mind");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState<"idle" | "asking" | "denied">("idle");

  const view = useQuery({
    queryKey: ["public-confirm", token],
    queryFn: () => ok(api.GET("/v1/public/confirm/{token}", { params: { path: { token } } })),
    retry: false,
    meta: { toast: false },
  });
  const answer = useMutation({
    mutationFn: (body: Answer) => ok(api.POST("/v1/public/confirm/{token}", { params: { path: { token } }, body })),
    meta: { toast: false },
    retry: false,
  });

  const shareLocation = () => {
    if (!("geolocation" in navigator)) { setLocating("denied"); return; }
    setLocating("asking");
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocation({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }); setLocating("idle"); },
      () => setLocating("denied"),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  if (view.isPending) return <SkeletonRows rows={4} label={t("loading")} />;
  if (view.isError) {
    const missing = view.error instanceof ApiError && view.error.status === 404;
    return <Done icon="error" title={missing ? t("invalid.title") : t("failed.title")} body={missing ? t("invalid.body") : t("failed.body")} />;
  }
  const v: View = answer.data ?? view.data;
  if (v.state !== "open") return <Finished v={v} />;

  const failure = answer.error instanceof ApiError ? answer.error : null;
  const send = (body: Answer) => answer.mutate({ ...body, ...(location ? { location } : {}) });
  const due = Number(v.order.cod.amount) > 0 ? v.order.cod : v.order.total;

  return (
    <div className="flex flex-col gap-5" data-testid="confirm-page">
      <header className="flex flex-col gap-1">
        <p className="text-body-sm text-text-2">{v.store}</p>
        <h1 className="font-display text-heading-lg">{v.firstName ? t("hello", { name: v.firstName }) : t("helloNoName")}</h1>
        <p className="text-body text-text-2">{t.rich("intro", { number: v.order.number, n: (c) => <Bdi code>{c}</Bdi> })}</p>
      </header>

      <section className="rounded-lg border border-line bg-surface">
        <ul className="divide-y divide-line">
          {v.order.items.map((it, i) => (
            <li key={i} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0 truncate">{it.title}</span>
              <span className="shrink-0 text-text-2">{t("qty", { count: it.quantity })}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
          <span className="font-medium">{Number(v.order.cod.amount) > 0 ? t("payOnDelivery") : t("total")}</span>
          <strong className="text-heading-sm"><MoneyText money={due} /></strong>
        </div>
        {v.order.city ? <p className="border-t border-line px-4 py-3 text-body-sm text-text-2">{t("deliverTo", { city: v.order.city })}</p> : null}
      </section>

      {failure ? <Alert tone="danger">{failure.status === 410 ? t("expired.body") : failure.status === 409 ? t("already") : t("failed.body")}</Alert> : null}

      {mode === "main" ? (
        <div className="flex flex-col gap-3">
          <Button size="lg" icon="confirm" busy={answer.isPending && answer.variables?.answer === "confirm"} onClick={() => send({ answer: "confirm" })}>{t("confirm")}</Button>
          {!v.hasLocation ? (
            <Button variant="secondary" icon="pin" busy={locating === "asking"} disabled={Boolean(location)} onClick={shareLocation}>
              {location ? t("location.added") : t("location.share")}
            </Button>
          ) : null}
          {locating === "denied" ? <p className="text-caption text-text-3">{t("location.denied")}</p> : null}
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" icon="edit" onClick={() => setMode("change")}>{t("change")}</Button>
            <Button variant="ghost" icon="close" onClick={() => setMode("cancel")}>{t("cancel")}</Button>
          </div>
        </div>
      ) : mode === "change" ? (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (note.trim()) send({ answer: "change", note: note.trim() }); }}>
          <TextArea label={t("changeLabel")} hint={t("changeHint")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} />
          <Button type="submit" busy={answer.isPending} disabled={!note.trim()}>{t("sendChange")}</Button>
          <Button variant="ghost" onClick={() => setMode("main")}>{t("back")}</Button>
        </form>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); send({ answer: "cancel", reason }); }}>
          <Select label={t("reasonLabel")} value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
            {REASONS.map((r) => <option key={r} value={r}>{t(`reasons.${r}`)}</option>)}
          </Select>
          <Button type="submit" variant="danger" busy={answer.isPending}>{t("sendCancel")}</Button>
          <Button variant="ghost" onClick={() => setMode("main")}>{t("back")}</Button>
        </form>
      )}
      <p className="text-center text-caption text-text-3">{t("privacy")}</p>
    </div>
  );
}

function Finished({ v }: { v: View }) {
  const t = useTranslations("confirm");
  const s = v.state as "confirmed" | "cancelled" | "changed" | "expired" | "closed";
  const icon = s === "confirmed" ? "success" : s === "cancelled" ? "close" : s === "changed" ? "call" : "info";
  return <Done icon={icon} title={t(`done.${s}.title`)} body={t(`done.${s}.body`, { store: v.store })} />;
}

function Done({ icon, title, body }: { icon: "success" | "close" | "call" | "info" | "error"; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center" role="status" data-testid="confirm-done">
      <Icon name={icon} size={32} />
      <h1 className="font-display text-heading-md">{title}</h1>
      <p className="max-w-[36ch] text-body text-text-2">{body}</p>
    </div>
  );
}
