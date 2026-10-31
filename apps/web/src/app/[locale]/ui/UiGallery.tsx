"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Badge, PaymentTag, RiskMeter, Tag, type BadgeTone, type PaymentMethod } from "@/components/ui/Badge";
import { Button, ButtonGroup, IconButton } from "@/components/ui/Button";
import { Checkbox, Segmented, Switch } from "@/components/ui/Choice";
import { Combobox } from "@/components/ui/Combobox";
import { Cell, DataTable, IdCell, type Column } from "@/components/ui/DataTable";
import { ConfirmDialog, Drawer } from "@/components/ui/Dialog";
import { Field, SearchInput, Select, TextArea } from "@/components/ui/Field";
import { MenuButton } from "@/components/ui/Menu";
import { StatCard } from "@/components/ui/StatCard";
import { Avatar, Card, EmptyState, KeyValue, Progress, SkeletonRows, Timeline } from "@/components/ui/Surface";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import { DateText, MoneyText, PhoneText } from "@/components/ui/Values";
import { formatMoney } from "@/lib/format";
import { CITIES, ORDERS, PROFIT_TREND, RTO_TREND, type OrderStatus, type SampleOrder } from "./sample";

const STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  new: "neutral", pending: "warning", confirmed: "success", shipped: "info", delivered: "success", refused: "danger",
};
const METHODS: readonly PaymentMethod[] = ["cod", "card", "wallet", "deposit", "bnpl", "bank_transfer"];
type View = "all" | "confirm" | "ship" | "transit";

function Section({ id, title, body, children }: { id: string; title: string; body: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t border-line pt-8">
      <div>
        <h2 id={id} className="font-display text-heading-md">{title}</h2>
        <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{body}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * Every UI kit component in the current language and theme (E4-3): the review page for design,
 * and the page the end-to-end tests drive (keyboard, RTL, dialogs, table selection).
 */
export function UiGallery() {
  const t = useTranslations("gallery");
  const tp = useTranslations("payments.method");
  const locale = useLocale() as "ar" | "en";
  const toast = useToast();
  const [view, setView] = useState<View>("all");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [city, setCity] = useState<string | null>("alexandria");
  const [autoConfirm, setAutoConfirm] = useState(true);
  const [notify, setNotify] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [panel, setPanel] = useState<SampleOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now()); // one clock for the sample ages

  const egp = (amount: string) => ({ amount, currency: "EGP" });
  const visible = ORDERS.filter((o) =>
    view === "all" ? true : view === "confirm" ? o.status === "new" || o.status === "pending" : view === "ship" ? o.status === "confirmed" : o.status === "shipped");
  const count = (v: View) => ORDERS.filter((o) =>
    v === "all" ? true : v === "confirm" ? o.status === "new" || o.status === "pending" : v === "ship" ? o.status === "confirmed" : o.status === "shipped").length;

  const columns: Column<SampleOrder>[] = [
    { id: "order", header: t("table.order"), cell: (o) => <button type="button" className="hover:underline" onClick={() => setPanel(o)}><IdCell>#{o.id}</IdCell></button>, sortValue: (o) => o.id },
    { id: "customer", header: t("table.customer"), cell: (o) => <Cell main={o.customer[locale]} sub={<PhoneText e164={o.phone} />} />, sortValue: (o) => o.customer[locale] },
    { id: "payment", header: t("table.payment"), cell: (o) => <PaymentTag method={o.payment} label={tp(o.payment)} /> },
    { id: "total", header: t("table.total"), numeric: true, cell: (o) => <MoneyText money={egp(o.total)} />, sortValue: (o) => Number(o.total) },
    {
      id: "risk", header: t("table.risk"), sortValue: (o) => o.risk,
      cell: (o) => (
        <Tooltip content={t("risk.reasons")}>
          <span tabIndex={0} className="rounded-xs"><RiskMeter score={o.risk} label={t("risk.label", { score: o.risk })} /></span>
        </Tooltip>
      ),
    },
    { id: "status", header: t("table.status"), cell: (o) => <Badge tone={STATUS_TONE[o.status]}>{t(`status.${o.status}`)}</Badge> },
    { id: "age", header: t("table.age"), cell: (o) => <span className="text-text-2"><DateText relative now={now} value={new Date(now - o.minutesAgo * 60_000)} /></span>, sortValue: (o) => -o.minutesAgo },
  ];

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 pt-6 pb-20 md:px-6">
      <header>
        <p className="mz-overline">{t("eyebrow")}</p>
        <h1 className="mt-1 font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1.5 max-w-[70ch] text-body text-text-2">{t("subtitle")}</p>
      </header>

      <Section id="buttons" title={t("buttons.title")} body={t("buttons.body")}>
        <ButtonGroup>
          <Button icon="cod">{t("buttons.primary")}</Button>
          <Button variant="secondary" icon="print">{t("buttons.secondary")}</Button>
          <Button variant="ghost">{t("buttons.ghost")}</Button>
          <Button variant="brand">{t("buttons.brand")}</Button>
          <Button variant="danger" icon="delete">{t("buttons.danger")}</Button>
          <IconButton icon="refresh" label={t("buttons.refresh")} variant="secondary" />
        </ButtonGroup>
        <ButtonGroup>
          <Button size="sm" variant="secondary">{t("buttons.small")}</Button>
          <Button>{t("buttons.medium")}</Button>
          <Button size="lg" iconEnd="forward">{t("buttons.large")}</Button>
          <Button busy={busy} onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 1500); }}>{t("buttons.busy")}</Button>
          <Button disabled>{t("buttons.disabled")}</Button>
        </ButtonGroup>
      </Section>

      <Section id="fields" title={t("fields.title")} body={t("fields.body")}>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label={t("fields.name")} hint={t("fields.nameHint")} defaultValue={t("fields.nameValue")} />
          <Field label={t("fields.phone")} ltr type="tel" defaultValue="0100 123 48" error={t("fields.phoneError")} />
          <Combobox label={t("fields.city")} options={CITIES.map((c) => ({ value: c.value, label: c[locale] }))} value={city} onChange={setCity}
            placeholder={t("fields.cityPlaceholder")} emptyText={t("fields.cityEmpty")} hint={t("fields.cityHint")} />
          <Select label={t("fields.courier")} defaultValue="bosta">
            <option value="bosta">{t("fields.couriers.bosta")}</option>
            <option value="aramex">{t("fields.couriers.aramex")}</option>
            <option value="mylerz">{t("fields.couriers.mylerz")}</option>
          </Select>
          <TextArea label={t("fields.note")} placeholder={t("fields.notePlaceholder")} className="md:col-span-2" />
          <SearchInput label={t("fields.search")} placeholder={t("fields.search")} shortcut="/" />
          <div className="flex flex-col gap-3">
            <Checkbox label={t("fields.checkbox")} defaultChecked />
            <Segmented label={t("fields.density")} value={density} onChange={setDensity}
              options={[{ value: "comfortable", label: t("fields.comfortable") }, { value: "compact", label: t("fields.compact") }]} />
          </div>
          <Card>
            <div className="flex flex-col gap-4">
              <Switch label={t("fields.autoConfirm")} description={t("fields.autoConfirmHint")} checked={autoConfirm} onChange={(e) => setAutoConfirm(e.target.checked)} />
              <Switch label={t("fields.notify")} checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            </div>
          </Card>
        </div>
      </Section>

      <Section id="status" title={t("statusSection.title")} body={t("statusSection.body")}>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(STATUS_TONE) as OrderStatus[]).map((s) => <Badge key={s} tone={STATUS_TONE[s]}>{t(`status.${s}`)}</Badge>)}
          <Badge tone="ink">{t("status.paid")}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {METHODS.map((m) => <PaymentTag key={m} method={m} label={tp(m)} />)}
          <Tag>{t("statusSection.tag")}</Tag>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          {[12, 55, 82].map((s) => <RiskMeter key={s} score={s} label={t("risk.label", { score: s })} />)}
        </div>
      </Section>

      <Section id="kpis" title={t("kpis.title")} body={t("kpis.body")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard hero className="sm:col-span-2 lg:col-span-1" label={t("kpis.netProfit")} value={formatMoney(egp("14820.00"), locale)}
            delta="12.4%" good period={t("kpis.vsLastWeek")} trend={PROFIT_TREND} trendLabel={t("kpis.trend")} />
          <StatCard label={t("kpis.margin")} value="31.2" unit="%" delta="1.8%" good period={t("kpis.vsLastWeek")} />
          <StatCard label={t("kpis.rto")} value="16.4" unit="%" delta="-2.1%" good period={t("kpis.vsLastWeek")} trend={RTO_TREND} trendLabel={t("kpis.trend")} />
          <StatCard label={t("kpis.cashWithCouriers")} value={formatMoney(egp("48300.00"), locale)} delta="-4.0%" good={false} period={t("kpis.vsLastWeek")} />
        </div>
      </Section>

      <Section id="table" title={t("table.title")} body={t("table.body")}>
        <Tabs label={t("tabs.label")} value={view} onChange={setView}
          items={[
            { value: "all", label: t("tabs.all"), count: count("all") },
            { value: "confirm", label: t("tabs.confirm"), count: count("confirm") },
            { value: "ship", label: t("tabs.ship"), count: count("ship") },
            { value: "transit", label: t("tabs.transit"), count: count("transit") },
          ]}>
          <DataTable label={t("table.label")} columns={columns} rows={visible} rowKey={(o) => o.id} rowLabel={(o) => t("table.rowLabel", { id: o.id })}
            selectable defaultSort={{ id: "age", dir: "desc" }}
            empty={<EmptyState icon="orders" title={t("empty.title")} body={t("empty.body")} />}
            bulkActions={(keys, clear) => (
              <>
                <Button size="sm" icon="shipping" onClick={() => {
                  const n = keys.size;
                  clear();
                  toast({ message: t("toast.shipped", { count: n }), action: { label: t("toast.undo"), onClick: () => toast({ message: t("toast.undone") }) } });
                }}>{t("table.ship", { count: keys.size })}</Button>
                <MenuButton label={t("menu.label")} variant="secondary" items={[
                  { id: "tag", label: t("menu.tag"), icon: "tag", onSelect: () => toast({ message: t("toast.tagged") }) },
                  { id: "export", label: t("menu.export"), icon: "export", onSelect: () => toast({ message: t("toast.exported") }) },
                  { id: "cancel", label: t("menu.cancel"), icon: "delete", danger: true, separatorBefore: true, onSelect: () => setConfirming(true) },
                ]} />
              </>
            )} />
        </Tabs>
      </Section>

      <Section id="panel" title={t("panel.title")} body={t("panel.body")}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Card title={t("panel.order", { id: ORDERS[0]!.id })} actions={<Button size="sm" variant="secondary" onClick={() => setPanel(ORDERS[0]!)}>{t("panel.open")}</Button>}>
            <OrderDetails order={ORDERS[0]!} now={now} />
          </Card>
          <Card title={t("panel.people")}>
            <ul className="flex flex-col gap-3">
              {ORDERS.slice(0, 3).map((o) => (
                <li key={o.id} className="flex items-center gap-3">
                  <Avatar name={o.customer[locale]} />
                  <Cell main={o.customer[locale]} sub={o.area[locale]} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      <Section id="feedback" title={t("feedback.title")} body={t("feedback.body")}>
        <div className="grid gap-3 md:grid-cols-2">
          <Alert title={t("feedback.infoLead")}>{t("feedback.info")}</Alert>
          <Alert tone="success" title={t("feedback.successLead")}>{t("feedback.success")}</Alert>
          <Alert tone="warning" title={t("feedback.warningLead")}>{t("feedback.warning")}</Alert>
          <Alert tone="danger" title={t("feedback.dangerLead")}>{t("feedback.danger")}</Alert>
        </div>
        <ButtonGroup>
          <Button variant="secondary" onClick={() => toast({ message: t("toast.saved") })}>{t("feedback.showToast")}</Button>
          <Button variant="danger" onClick={() => setConfirming(true)}>{t("feedback.cancelOrder")}</Button>
        </ButtonGroup>
        <div className="grid gap-4 md:grid-cols-2">
          <Card title={t("feedback.loading")} bodyClassName="p-0"><SkeletonRows rows={4} label={t("feedback.loading")} /></Card>
          <Card title={t("feedback.progress")}>
            <div className="flex flex-col gap-2">
              <p className="text-body-sm text-text-2">{t("feedback.progressBody", { done: 18, total: 24 })}</p>
              <Progress value={75} label={t("feedback.progress")} />
            </div>
          </Card>
        </div>
        <Card bodyClassName="p-0">
          <EmptyState icon="returns" title={t("empty.returnsTitle")} body={t("empty.returnsBody")} action={<Button variant="secondary">{t("empty.returnsAction")}</Button>} />
        </Card>
      </Section>

      <ConfirmDialog open={confirming} onClose={() => setConfirming(false)}
        onConfirm={() => { setConfirming(false); toast({ message: t("toast.cancelled", { id: ORDERS[0]!.id }) }); }}
        title={t("dialog.title", { id: ORDERS[0]!.id })} description={t("dialog.body")} confirmLabel={t("dialog.confirm")} />
      <Drawer open={panel !== null} onClose={() => setPanel(null)} title={panel ? t("panel.order", { id: panel.id }) : ""}
        footer={<><Button variant="secondary" onClick={() => setPanel(null)}>{t("panel.close")}</Button><Button icon="verification">{t("panel.confirm")}</Button></>}>
        {panel ? <OrderDetails order={panel} now={now} /> : null}
      </Drawer>
    </div>
  );
}

function OrderDetails({ order, now }: { order: SampleOrder; now: number }) {
  const t = useTranslations("gallery");
  const tp = useTranslations("payments.method");
  const locale = useLocale() as "ar" | "en";
  const ago = (m: number) => <DateText relative now={now} value={new Date(now - m * 60_000)} />;
  return (
    <div className="flex flex-col gap-5">
      <KeyValue items={[
        { label: t("panel.customer"), value: order.customer[locale] },
        { label: t("panel.phone"), value: <PhoneText e164={order.phone} revealable /> },
        { label: t("panel.area"), value: order.area[locale] },
        { label: t("panel.payment"), value: <PaymentTag method={order.payment} label={tp(order.payment)} /> },
        { label: t("panel.total"), value: <MoneyText money={{ amount: order.total, currency: "EGP" }} /> },
        { label: t("panel.risk"), value: <RiskMeter score={order.risk} label={t("risk.label", { score: order.risk })} /> },
      ]} />
      <div>
        <h3 className="mb-2 text-label">{t("panel.history")}</h3>
        <Timeline label={t("panel.history")} items={[
          { id: "call", title: t("timeline.call"), detail: t("timeline.callDetail"), time: ago(order.minutesAgo) },
          { id: "risk", title: t("timeline.risk"), detail: <Bdi>{t("risk.label", { score: order.risk })}</Bdi>, time: ago(order.minutesAgo + 2) },
          { id: "created", title: t("timeline.created"), time: ago(order.minutesAgo + 3) },
        ]} />
      </div>
    </div>
  );
}
