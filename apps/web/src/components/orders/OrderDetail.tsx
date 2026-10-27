"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Badge, RiskMeter, Tag } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Cell, DataTable, IdCell, type Column } from "@/components/ui/DataTable";
import { Card, EmptyState, KeyValue, SkeletonRows, Timeline } from "@/components/ui/Surface";
import { DateText, MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { ConfirmationCard } from "./ConfirmationCard";
import { DuplicateBanner } from "./DuplicateBanner";
import { LedgerCard } from "./LedgerCard";
import { RefundsCard } from "@/components/payments/Refunds";
import { ProfitCard } from "./ProfitCard";
import { TicketsCard } from "./TicketsCard";
import { MODE_ICON, STATUS_TONE, isStatus, maskedLast4 } from "./order-ui";

/** Risk reason codes the API writes (E6-1); an unknown code is shown as is. */
const RISK_REASONS = new Set(["delivered_before", "refused_before", "cancelled_before", "first_order", "duplicate", "address_incomplete", "no_city", "phone_invalid", "high_value", "very_high_value", "bulk_quantity", "velocity", "chargeback_before", "bnpl", "awaiting_transfer", "paid"]);

type Order = Schemas["OrderDetail"];
type Line = Order["lines"][number];
type Event = Order["events"][number];
type Revealed = Schemas["RevealedCustomer"];

const PAYMENT_STATUSES = new Set(["unpaid", "authorized", "partially_paid", "paid", "partially_refunded", "refunded", "disputed", "failed", "voided"]);
const LEDGER_KINDS = new Set(["authorization", "capture", "sale", "cod_collection", "refund", "chargeback", "chargeback_reversal", "void"]);
const LEDGER_METHODS = new Set(["cod", "card", "wallet", "apple_pay", "bnpl", "bank_transfer", "instapay", "fawry_ref", "store_credit", "cash_pos", "marketplace"]);
const ANSWER_CHANNELS = new Set(["link", "whatsapp", "sms", "voice_ivr", "voice_ai", "agent"]);
const sourceName = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const mapsUrl = (l: { lat: number; lng: number }) => `https://www.google.com/maps?q=${l.lat},${l.lng}`;
const isZero = (m: { amount: string }) => Number(m.amount) === 0;

/**
 * M1 order detail (E5-2). Everything an operator needs to act on one order, with the customer
 * masked like the list; "Show details" asks the API, which decrypts and records the view (audit).
 * Revealed details live in this component's state only: never cached, gone on navigation.
 */
export function OrderDetail({ id }: { id: string }) {
  const t = useTranslations("orders");
  const tm = useTranslations("payments.mode");
  const tp = useTranslations("payments.status");
  const tpr = useTranslations("problems");
  const { api, user, store } = useSession();
  const order = useQuery({
    queryKey: ["order", user?.uid ?? "", store?.tenantId ?? "", id],
    queryFn: () => ok(api.GET("/v1/orders/{id}", { params: { path: { id } } })),
    enabled: Boolean(store),
    meta: { toast: false },
  });

  const back = (
    <Link href="/orders" className="inline-flex items-center gap-1.5 text-body-sm text-text-2 hover:text-text">
      <Icon name="back" size={16} />{t("detail.back")}
    </Link>
  );
  if (order.isPending) return <Page>{back}<div className="mz-card"><SkeletonRows rows={6} label={t("detail.loading")} /></div></Page>;
  if (order.isError) {
    const missing = order.error instanceof ApiError && (order.error.status === 404 || order.error.status === 400);
    return (
      <Page>
        {back}
        <div className="mz-card">
          {missing ? <EmptyState icon="orders" title={t("detail.notFound.title")} body={t("detail.notFound.body")} />
            : <EmptyState icon="error" title={problemText(order.error, tpr)} body="" action={<Button variant="secondary" onClick={() => void order.refetch()}>{tpr("retry")}</Button>} />}
        </div>
      </Page>
    );
  }

  const o = order.data;
  const paymentLabel = (s: string) => (PAYMENT_STATUSES.has(s) ? tp(s as Order["paymentStatus"]) : s);
  const statusLabel = (s: string | null) => (isStatus(s) ? t(`status.${s}`) : s ?? "");
  const channelLabel = (c: string | undefined) => (c && ANSWER_CHANNELS.has(c) ? t(`answerChannel.${c as "link"}`) : t("answerChannel.other"));
  const eventTitle = (e: Event) => {
    switch (e.type) {
      case "created": return t("events.created", { source: sourceName(e.data.source ?? o.store.provider ?? "") });
      case "updated": return e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus
        ? t("events.statusChanged", { from: statusLabel(e.fromStatus), to: statusLabel(e.toStatus) }) : t("events.updated");
      case "payment_changed": return t("events.payment_changed", { from: paymentLabel(e.data.from ?? ""), to: paymentLabel(e.data.to ?? "") });
      case "awaiting_payment": return t("events.awaiting_payment");
      case "confirmation_started": return t("events.confirmation_started");
      case "confirmed": return t("events.confirmed", { channel: channelLabel(e.data.channel) });
      case "cancelled": return t("events.cancelled", { channel: channelLabel(e.data.channel) });
      case "change_requested": return t("events.change_requested", { channel: channelLabel(e.data.channel) });
      case "confirmation_escalated": return t("events.confirmation_escalated");
      default: return t("events.other");
    }
  };

  const lineColumns: Column<Line>[] = [
    { id: "item", header: t("detail.lines.item"), cell: (l) => <Cell main={l.title} sub={l.sku ? <IdCell>{l.sku}</IdCell> : t("detail.lines.noSku")} /> },
    { id: "qty", header: t("detail.lines.qty"), numeric: true, cell: (l) => <Bdi>{l.quantity}</Bdi> },
    { id: "price", header: t("detail.lines.price"), numeric: true, cell: (l) => <MoneyText money={l.unitPrice} /> },
    { id: "total", header: t("detail.lines.total"), numeric: true, cell: (l) => <MoneyText money={l.total} /> },
  ];
  const money = [
    { label: t("detail.money.subtotal"), value: <MoneyText money={o.subtotal} /> },
    { label: t("detail.money.shipping"), value: <MoneyText money={o.shipping} /> },
    ...(isZero(o.discount) ? [] : [{ label: t("detail.money.discount"), value: <MoneyText money={o.discount} /> }]),
    { label: t("detail.money.total"), value: <strong><MoneyText money={o.total} /></strong> },
    { label: t("detail.money.paid"), value: <MoneyText money={o.paid} /> },
    ...(isZero(o.refunded) ? [] : [{ label: t("detail.money.refunded"), value: <MoneyText money={o.refunded} /> }]),
    { label: t("detail.money.balance"), value: <MoneyText money={o.balance} /> },
    ...(isZero(o.cod) ? [] : [{ label: t("detail.money.cod"), value: <strong><MoneyText money={o.cod} /></strong> }]),
  ];

  return (
    <Page>
      {back}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-display text-heading-lg"><IdCell>{o.number}</IdCell></h1>
        <Badge tone={STATUS_TONE[o.status]}>{t(`status.${o.status}`)}</Badge>
        <Tag icon={MODE_ICON[o.paymentMode]}>{tm(o.paymentMode)}</Tag>
        <Badge tone="neutral" dot={false}>{tp(o.paymentStatus)}</Badge>
        {o.stock === "short" ? <Badge tone="danger">{t("stock.short")}</Badge> : o.stock === "reserved" ? <Badge tone="success">{t("stock.reserved")}</Badge> : null}
        <p className="w-full text-body-sm text-text-2">
          {t("detail.placed")}{" "}<DateText value={o.placedAt} />{" · "}{t("detail.store")}{" "}{o.store.provider ? sourceName(o.store.provider) : t("manual")}
        </p>
      </header>

      {o.duplicateOf && o.duplicate ? <DuplicateBanner order={o} /> : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={t("detail.lines.title")} bodyClassName="p-0">
            <DataTable label={t("detail.lines.title")} columns={lineColumns} rows={o.lines} rowKey={(l) => l.id}
              empty={<EmptyState icon="product" title={t("detail.lines.empty")} body="" />} />
          </Card>
          <Card title={t("detail.money.title")}><KeyValue items={money} /></Card>
          <ProfitCard orderId={o.id} moving={["new", "pending_confirmation", "confirmed", "shipped"].includes(o.status)} />
          <LedgerCard orderId={o.id} fallback={(
            <Card title={t("detail.payments.title")}>
              {o.payments.length === 0 ? <p className="text-body-sm text-text-2">{t("detail.payments.empty")}</p> : (
                <ul className="flex flex-col divide-y divide-line">
                  {o.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <span>
                        <span className="font-medium">{LEDGER_KINDS.has(p.kind) ? t(`detail.kind.${p.kind as "sale"}`) : p.kind}</span>
                        <span className="text-text-2">{" · "}{LEDGER_METHODS.has(p.method) ? t(`detail.method.${p.method as "cod"}`) : p.method}</span>
                        <span className="block text-caption text-text-3"><DateText value={p.occurredAt} /></span>
                      </span>
                      <MoneyText money={p.amount} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )} />
          <RefundsCard orderId={o.id} />
          {o.shipments.length ? (
            <Card title={t("detail.shipments.title")}>
              <ul className="flex flex-col gap-2">
                {o.shipments.map((s) => <li key={s.id}><IdCell>{s.trackingNumber ?? s.id}</IdCell>{" · "}{sourceName(s.provider)}{" · "}{s.status}</li>)}
              </ul>
            </Card>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4">
          <CustomerCard order={o} />
          <ConfirmationCard orderId={o.id} orderStatus={o.status} />
          <TicketsCard order={{ id: o.id, number: o.number }} />
          <Card title={t("detail.risk.title")}>
            {o.risk === null ? <p className="text-body-sm text-text-2">{t("detail.risk.notScored")}</p> : (
              <div className="flex flex-col gap-2">
                <RiskMeter score={o.risk} label={t("riskLabel", { score: o.risk })} />
                {o.riskReasons.length ? <div className="flex flex-wrap gap-1.5">{o.riskReasons.map((r) => <Tag key={r}>{RISK_REASONS.has(r) ? t(`detail.risk.reason.${r}`) : r}</Tag>)}</div> : null}
              </div>
            )}
          </Card>
          <Card title={t("detail.timeline.title")}>
            {o.events.length === 0 ? <p className="text-body-sm text-text-2">{t("detail.timeline.empty")}</p> : (
              <Timeline label={t("detail.timeline.title")} items={o.events.map((e) => ({
                id: e.id, title: eventTitle(e),
                detail: e.type === "updated" && e.data.changed?.length ? t("events.changed", { fields: e.data.changed.join(", ") }) : undefined,
                time: <span className="text-caption text-text-3"><DateText value={e.at} /></span>,
              }))} />
            )}
          </Card>
        </aside>
      </div>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6">{children}</div>;
}

/** Masked by default; "Show details" is an audited request, and the answer is never cached. */
export function CustomerCard({ order: o }: { order: Order }) {
  const t = useTranslations("orders.detail.customer");
  const tpr = useTranslations("problems");
  const { api } = useSession();
  const [shown, setShown] = useState<Revealed | null>(null);
  const reveal = useMutation({
    mutationFn: () => ok(api.POST("/v1/orders/{id}/reveal", { params: { path: { id: o.id } } })),
    onSuccess: setShown,
    meta: { toast: false },
    retry: false,
  });
  const area = [o.area.city, o.area.province].filter(Boolean);
  const failure = reveal.error instanceof ApiError ? reveal.error : null;

  if (o.redacted) return <Card title={t("title")}><p className="text-body-sm text-text-2">{t("redacted")}</p></Card>;
  const hasAny = o.customer.label || o.customer.phoneLast4 || area.length;
  return (
    <Card title={t("title")} actions={shown ? <Button variant="ghost" size="sm" onClick={() => { setShown(null); reveal.reset(); }}>{t("hide")}</Button> : null}>
      {!hasAny ? <p className="text-body-sm text-text-2">{t("none")}</p> : shown ? (
        <div className="flex flex-col gap-3" data-testid="customer-revealed">
          <KeyValue items={[
            { label: t("name"), value: shown.name ?? "—" },
            { label: t("phone"), value: shown.phone ? <a href={`tel:${shown.phone}`} className="hover:underline"><Bdi code>{shown.phone}</Bdi></a> : "—" },
            {
              label: t("address"),
              value: (
                <address className="not-italic">
                  {[shown.address.line1, shown.address.line2, shown.address.city, shown.address.province].filter(Boolean).map((l) => <span key={l} className="block">{l}</span>)}
                </address>
              ),
            },
          ]} />
          {shown.location ? (
            <a href={mapsUrl(shown.location)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-body-sm font-medium underline underline-offset-2">
              <Icon name="pin" size={16} />{t("map")}
            </a>
          ) : <p className="inline-flex items-center gap-1.5 text-caption text-text-3"><Icon name="pin" size={14} />{t("noPin")}</p>}
          <p className="text-caption text-text-3">{t("recorded")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <KeyValue items={[
            { label: t("name"), value: o.customer.label ?? "—" },
            { label: t("phone"), value: o.customer.phoneLast4 ? <IdCell>{maskedLast4(o.customer.phoneLast4)}</IdCell> : "—" },
            { label: t("area"), value: area.length ? area.join(" · ") : "—" },
          ]} />
          {failure?.code === "pii_redacted" ? <Alert tone="warning">{t("gone")}</Alert>
            : failure?.status === 429 ? <Alert tone="warning">{t("tooMany")}</Alert>
            : reveal.isError ? <Alert tone="danger">{problemText(reveal.error, tpr)}</Alert> : null}
          <div>
            <Button variant="secondary" size="sm" icon="visible" busy={reveal.isPending} onClick={() => reveal.mutate()}>{t("show")}</Button>
          </div>
          <p className="text-caption text-text-3">{t("recorded")}</p>
        </div>
      )}
    </Card>
  );
}
