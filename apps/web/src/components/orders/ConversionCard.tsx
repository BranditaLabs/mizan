"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Choice";
import { Field, Select } from "@/components/ui/Field";
import { Card } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { DateText, MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";

type Conversion = Schemas["OrderConversion"];
type Method = Schemas["NewConversion"]["method"];
const ROLES = new Set(["owner", "admin", "ops_manager", "agent", "finance"]);
const TONE: Record<NonNullable<Conversion["current"]>["status"], BadgeTone> = { open: "info", paid: "success", expired: "neutral", cancelled: "neutral" };

/**
 * COD to prepaid (E14-3): offer the customer to pay all, or a deposit, before shipping; Mizan
 * writes the message to send (copy it into WhatsApp). When the team records the payment, the offer
 * is paid and the courier collects less. Shown for COD orders not yet shipped.
 */
export function ConversionCard({ orderId }: { orderId: string }) {
  const t = useTranslations("conversion");
  const tpr = useTranslations("problem");
  const { api, user, store } = useSession();
  const locale = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const allowed = ROLES.has(store?.role ?? "");
  const q = useQuery({
    queryKey: ["conversion", user?.uid ?? "", store?.tenantId ?? "", orderId],
    queryFn: () => ok(api.GET("/v1/orders/{id}/conversion", { params: { path: { id: orderId } } })),
    enabled: Boolean(store) && allowed,
    meta: { toast: false },
  });
  const [purpose, setPurpose] = useState<"full" | "deposit">("deposit");
  const [method, setMethod] = useState<Method | "">("");
  const [amount, setAmount] = useState("");
  const done = () => void qc.invalidateQueries({ queryKey: ["conversion"] });
  const offer = useMutation({
    mutationFn: () => ok(api.POST("/v1/orders/{id}/conversion", { params: { path: { id: orderId } }, body: {
      purpose, method: (method || q.data!.methods[0]) as Method, ...(purpose === "deposit" && amount.trim() ? { amount: amount.trim() } : {}),
    } })),
    meta: { toast: false },
    onSuccess: () => { toast({ message: t("offered") }); setAmount(""); done(); },
  });
  const cancel = useMutation({
    mutationFn: () => ok(api.POST("/v1/orders/{id}/conversion/cancel", { params: { path: { id: orderId } } })),
    meta: { toast: false },
    onSuccess: () => { toast({ message: t("cancelled") }); done(); },
  });
  const c: Conversion | undefined = q.data;
  if (!allowed || !c || (!c.eligible && !c.current)) return null;
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast({ message: t("copied") }); } catch { /* the text stays visible to copy by hand */ }
  };
  const err = offer.error instanceof ApiError ? offer.error : null;
  const message = err?.code === "no_instructions" ? t("noInstructions") : offer.isError ? problemText(offer.error, tpr) : cancel.isError ? problemText(cancel.error, tpr) : null;
  const open = c.current?.status === "open";
  const text = c.message ? (locale === "en" ? c.message.en : c.message.ar) : null;
  return (
    <Card title={t("title")}>
      <div className="flex flex-col gap-3" data-testid="order-conversion">
        <p className="text-caption text-text-3">{t("hint")}</p>
        {c.current ? (
          <div className="flex flex-wrap items-center gap-2 text-body-sm">
            <Badge tone={TONE[c.current.status]}>{t(`status.${c.current.status}`)}</Badge>
            <span>{t(`purpose.${c.current.purpose}`)} · <MoneyText money={c.current.amount} /> · {t(`method.${c.current.method}`)}</span>
            {open && c.current.expiresAt ? <span className="text-caption text-text-3">{t("until")} <DateText value={c.current.expiresAt} /></span> : null}
          </div>
        ) : null}
        {open && text ? (
          <>
            <pre dir="auto" className="whitespace-pre-wrap rounded-md bg-surface-sunk p-3 font-sans text-body-sm" data-testid="conversion-message">{text}</pre>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon="copy" onClick={() => void copy(text)}>{t("copy")}</Button>
              <Button size="sm" variant="ghost" busy={cancel.isPending} onClick={() => cancel.mutate()}>{t("cancel")}</Button>
            </div>
            <p className="text-caption text-text-3">{t("whenPaid")}</p>
          </>
        ) : null}
        {!open && c.eligible ? (
          c.methods.length === 0 ? (
            <Alert tone="info">{t("setUp")} <Link href="/settings/payments" className="underline">{t("setUpLink")}</Link></Alert>
          ) : (
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); offer.mutate(); }}>
              <p className="text-body-sm">{t("owed")} <MoneyText money={c.owed} /></p>
              <Segmented label={t("what")} value={purpose} onChange={setPurpose} options={[{ value: "deposit", label: t("purpose.deposit") }, { value: "full", label: t("purpose.full") }]} />
              {purpose === "deposit" ? (
                <Field label={t("depositAmount")} hint={t.rich("depositHint", { amount: () => <MoneyText money={c.deposit} /> })} ltr inputMode="decimal" value={amount} placeholder={c.deposit.amount} onChange={(e) => setAmount(e.target.value)} />
              ) : null}
              <Select label={t("how")} value={method || c.methods[0]} onChange={(e) => setMethod(e.target.value as Method)}>
                {c.methods.map((m) => <option key={m} value={m}>{t(`method.${m}`)}</option>)}
              </Select>
              {message ? <Alert tone="danger">{message}</Alert> : null}
              <div><Button type="submit" busy={offer.isPending}>{t("offer")}</Button></div>
            </form>
          )
        ) : null}
        {!c.eligible && c.reason && !open ? <p className="text-caption text-text-3">{t(`reason.${c.reason}`)}</p> : null}
      </div>
    </Card>
  );
}
