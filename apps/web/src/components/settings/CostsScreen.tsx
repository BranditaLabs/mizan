"use client";

import { toAsciiDigits } from "@mizan/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { Card, EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { DateText, MoneyText } from "@/components/ui/Values";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type Rule = Schemas["CostRule"];
type NewRule = Schemas["CreateCostRule"];
type Kind = Rule["kind"];

const AMOUNT = /^\d{1,12}(\.\d{1,3})?$/;
const PERCENT = /^\d{1,3}(\.\d{1,3})?$/;
const RATE = /^\d{1,10}(\.\d{1,8})?$/;
/** What people type, Arabic digits and decimal comma included, as an API decimal ("٧٫٥" → "7.5"). */
const decimal = (v: string) => toAsciiDigits(v).replace(/[٫,]/g, ".").trim();
const isPercent = (v: string) => PERCENT.test(v) && Number(v) <= 100;

const FEE_METHODS = ["card", "wallet", "apple_pay", "bnpl", "instapay", "bank_transfer"] as const;
const COURIERS = ["bosta", "jt", "aramex", "mylerz", "other"] as const;
const EDITORS = new Set(["owner", "admin", "finance"]);
const READERS = new Set([...EDITORS, "ops_manager"]);

/**
 * Settings → Costs (M5, E9-1): what an order costs beyond its products, for real profit.
 * Every save is a new version from today; older orders keep the cost of their day (the API closes
 * the previous version). Exchange rates: the daily feed, with the store's own rate for a day.
 */
export function CostsScreen() {
  const t = useTranslations("costs");
  const { api, user, store } = useSession();
  const role = store?.role ?? "";
  const canRead = READERS.has(role);
  const canEdit = EDITORS.has(role);
  const rules = useQuery({
    queryKey: ["costRules", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/cost-rules")),
    enabled: Boolean(store) && canRead,
  });

  if (!canRead) {
    return <Page title={t("title")} subtitle={t("subtitle")}><div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div></Page>;
  }
  if (rules.isPending) return <Page title={t("title")} subtitle={t("subtitle")}><div className="mz-card"><SkeletonRows rows={6} label={t("loading")} /></div></Page>;
  if (rules.isError) return <Page title={t("title")} subtitle={t("subtitle")}><Alert tone="danger">{t("loadFailed")}</Alert></Page>;

  const { data, baseCurrency } = rules.data;
  const find = (kind: Kind, match: (r: Rule) => boolean = (r) => Object.keys(r.scope).length === 0) => data.find((r) => r.kind === kind && match(r)) ?? null;
  const all = (kind: Kind) => data.filter((r) => r.kind === kind);
  const ctx = { canEdit, currency: baseCurrency };

  return (
    <Page title={t("title")} subtitle={t("subtitle")}>
      <Alert tone="info">{t.rich("versioning", { day: "", d: () => <DateText value={`${rules.data.today}T12:00:00Z`} /> })}</Alert>
      {!canEdit ? <Alert tone="warning">{t("readOnly")}</Alert> : null}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card title={t("perOrder.title")}>
          <p className="mb-3 text-body-sm text-text-2">{t("perOrder.body")}</p>
          <div className="flex flex-col gap-4">
            <AmountRule {...ctx} label={t("perOrder.packaging")} hint={t("perOrder.packagingHint")} rule={find("packaging_per_order")} make={(amount) => ({ kind: "packaging_per_order", amount, scope: {} })} />
            <AmountRule {...ctx} label={t("perOrder.agent")} hint={t("perOrder.agentHint")} rule={find("agent_per_order")} make={(amount) => ({ kind: "agent_per_order", amount, scope: {} })} />
          </div>
        </Card>

        <Card title={t("cod.title")}>
          <p className="mb-3 text-body-sm text-text-2">{t("cod.body")}</p>
          <PercentRule {...ctx} label={t("cod.pct")} rule={find("cod_fee_pct")} make={(pct) => ({ kind: "cod_fee_pct", pct, scope: {} })} />
        </Card>

        <Card title={t("payment.title")} className="lg:col-span-2">
          <p className="mb-3 text-body-sm text-text-2">{t("payment.body")}</p>
          <ul className="flex flex-col divide-y divide-line">
            {FEE_METHODS.map((m) => <li key={m} className="py-3"><PaymentFeeRow {...ctx} method={m} rule={find("payment_fee_pct", (r) => r.scope.method === m)} /></li>)}
          </ul>
        </Card>

        <Card title={t("courier.title")} className="lg:col-span-2">
          <p className="mb-3 text-body-sm text-text-2">{t("courier.body")}</p>
          <RuleList rules={all("courier_rate")} canEdit={canEdit} empty={t("courier.empty")}
            describe={(r) => (
              <>
                <span className="font-medium">{t(`courier.names.${(COURIERS as readonly string[]).includes(r.scope.courier ?? "") ? r.scope.courier as "bosta" : "other"}`)}</span>
                {r.scope.zone ? <span className="text-text-2">{" · "}{r.scope.zone}</span> : <span className="text-text-2">{" · "}{t("courier.allZones")}</span>}
                <span className="block text-caption text-text-2">
                  {t("courier.delivery")}{" "}{r.amount ? <MoneyText money={r.amount} /> : null}
                  {r.returnAmount ? <>{" · "}{t("courier.return")}{" "}<MoneyText money={r.returnAmount} /></> : null}
                </span>
              </>
            )} />
          {canEdit ? <CourierForm currency={baseCurrency} /> : null}
        </Card>

        <Card title={t("monthly.title")} className="lg:col-span-2">
          <p className="mb-3 text-body-sm text-text-2">{t("monthly.body")}</p>
          <RuleList rules={all("fixed_monthly")} canEdit={canEdit} empty={t("monthly.empty")}
            describe={(r) => <><span className="font-medium">{r.scope.label}</span>{" · "}{r.amount ? <MoneyText money={r.amount} /> : null}</>} />
          {canEdit ? <MonthlyForm currency={baseCurrency} /> : null}
        </Card>

        <FxCard canEdit={canEdit} today={rules.data.today} />
      </div>
    </Page>
  );
}

function Page({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6">
      <header>
        <h1 className="font-display text-heading-lg">{title}</h1>
        <p className="mt-1 text-body-sm text-text-2">{subtitle}</p>
      </header>
      {children}
    </div>
  );
}

/** Saves a new rule version and refreshes the lists; the toast says it is in. */
function useSaveRule(onDone?: () => void) {
  const t = useTranslations("costs");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: NewRule) => ok(api.POST("/v1/cost-rules", { body })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["costRules"] }); toast({ message: t("saved") }); onDone?.(); },
  });
}

function Since({ rule }: { rule: Rule | null }) {
  const t = useTranslations("costs");
  if (!rule) return <span className="text-caption text-text-3">{t("notSet")}</span>;
  return <span className="text-caption text-text-3">{t("since")}{" "}<DateText value={`${rule.validFrom}T12:00:00Z`} /></span>;
}

function AmountRule({ label, hint, rule, make, canEdit, currency }:
  { label: string; hint: string; rule: Rule | null; make(amount: string): NewRule; canEdit: boolean; currency: string }) {
  const t = useTranslations("costs");
  const [value, setValue] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const save = useSaveRule(() => setValue(null));
  const shown = value ?? rule?.amount?.amount ?? "";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = decimal(shown);
    setInvalid(!AMOUNT.test(v));
    if (AMOUNT.test(v)) save.mutate(make(v));
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2" noValidate>
      <Field label={`${label} (${currency})`} hint={hint} error={invalid ? t("invalidAmount") : null} ltr inputMode="decimal" autoComplete="off" placeholder="0.00"
        value={shown} onChange={(e) => setValue(e.target.value)} disabled={!canEdit} className="w-48" />
      {canEdit ? <Button type="submit" variant="secondary" busy={save.isPending} disabled={value === null}>{t("save")}</Button> : null}
      <div className="basis-full"><Since rule={rule} /></div>
    </form>
  );
}

function PercentRule({ label, rule, make, canEdit }: { label: string; rule: Rule | null; make(pct: string): NewRule; canEdit: boolean; currency: string }) {
  const t = useTranslations("costs");
  const [value, setValue] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const save = useSaveRule(() => setValue(null));
  const shown = value ?? rule?.pct ?? "";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = decimal(shown);
    setInvalid(!isPercent(v));
    if (isPercent(v)) save.mutate(make(v));
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2" noValidate>
      <Field label={label} error={invalid ? t("invalidPercent") : null} ltr inputMode="decimal" autoComplete="off" placeholder="0"
        value={shown} onChange={(e) => setValue(e.target.value)} disabled={!canEdit} className="w-32" />
      {canEdit ? <Button type="submit" variant="secondary" busy={save.isPending} disabled={value === null}>{t("save")}</Button> : null}
      <div className="basis-full"><Since rule={rule} /></div>
    </form>
  );
}

function PaymentFeeRow({ method, rule, canEdit, currency }: { method: (typeof FEE_METHODS)[number]; rule: Rule | null; canEdit: boolean; currency: string }) {
  const t = useTranslations("costs");
  const [pct, setPct] = useState<string | null>(null);
  const [fixed, setFixed] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const save = useSaveRule(() => { setPct(null); setFixed(null); });
  const p = pct ?? rule?.pct ?? "";
  const f = fixed ?? rule?.fixed?.amount ?? "";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const pv = decimal(p);
    const fv = decimal(f);
    const bad = !isPercent(pv) || (fv !== "" && !AMOUNT.test(fv));
    setInvalid(bad);
    if (!bad) save.mutate({ kind: "payment_fee_pct", pct: pv, ...(fv && Number(fv) > 0 ? { fixed: fv } : {}), scope: { method } });
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2" noValidate aria-label={t(`payment.methods.${method}`)}>
      <p className="w-full font-medium sm:w-36 sm:self-center">{t(`payment.methods.${method}`)}</p>
      <Field label={t("payment.pct")} ltr inputMode="decimal" autoComplete="off" placeholder="0" value={p} onChange={(e) => setPct(e.target.value)} disabled={!canEdit} className="w-24" />
      <Field label={`${t("payment.fixed")} (${currency})`} ltr inputMode="decimal" autoComplete="off" placeholder="0.00" value={f} onChange={(e) => setFixed(e.target.value)} disabled={!canEdit} className="w-32" />
      {canEdit ? <Button type="submit" variant="secondary" busy={save.isPending} disabled={pct === null && fixed === null}>{t("save")}</Button> : null}
      <div className="basis-full">{invalid ? <span className="text-caption text-danger">{t("invalidPercent")}</span> : <Since rule={rule} />}</div>
    </form>
  );
}

function RuleList({ rules, describe, canEdit, empty }: { rules: Rule[]; describe(r: Rule): ReactNode; canEdit: boolean; empty: string }) {
  const t = useTranslations("costs");
  const { api } = useSession();
  const qc = useQueryClient();
  const end = useMutation({
    mutationFn: (id: string) => ok(api.DELETE("/v1/cost-rules/{id}", { params: { path: { id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["costRules"] }),
  });
  if (!rules.length) return <p className="mb-3 text-body-sm text-text-3">{empty}</p>;
  return (
    <ul className="mb-4 flex flex-col divide-y divide-line rounded-md border border-line">
      {rules.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
          <div className="min-w-0">{describe(r)}<span className="block"><Since rule={r} /></span></div>
          {canEdit ? <Button variant="ghost" size="sm" busy={end.isPending && end.variables === r.id} onClick={() => end.mutate(r.id)}>{t("end")}</Button> : null}
        </li>
      ))}
    </ul>
  );
}

function CourierForm({ currency }: { currency: string }) {
  const t = useTranslations("costs");
  const [courier, setCourier] = useState<(typeof COURIERS)[number]>("bosta");
  const [zone, setZone] = useState("");
  const [amount, setAmount] = useState("");
  const [ret, setRet] = useState("");
  const [invalid, setInvalid] = useState(false);
  const save = useSaveRule(() => { setZone(""); setAmount(""); setRet(""); });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const a = decimal(amount);
    const r = decimal(ret);
    const bad = !AMOUNT.test(a) || (r !== "" && !AMOUNT.test(r));
    setInvalid(bad);
    if (!bad) save.mutate({ kind: "courier_rate", amount: a, ...(r ? { returnAmount: r } : {}), scope: { courier, ...(zone.trim() ? { zone: zone.trim() } : {}) } });
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2" noValidate aria-label={t("courier.add")}>
      <Select label={t("courier.courier")} value={courier} onChange={(e) => setCourier(e.target.value as typeof courier)} className="w-36">
        {COURIERS.map((c) => <option key={c} value={c}>{t(`courier.names.${c}`)}</option>)}
      </Select>
      <Field label={t("courier.zone")} hint={t("courier.zoneHint")} value={zone} onChange={(e) => setZone(e.target.value)} autoComplete="off" className="w-40" />
      <Field label={`${t("courier.delivery")} (${currency})`} ltr inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32"
        error={invalid ? t("invalidAmount") : null} />
      <Field label={`${t("courier.return")} (${currency})`} ltr inputMode="decimal" autoComplete="off" placeholder="0.00" value={ret} onChange={(e) => setRet(e.target.value)} className="w-32" />
      <Button type="submit" icon="add" busy={save.isPending} disabled={!amount.trim()}>{t("courier.add")}</Button>
    </form>
  );
}

function MonthlyForm({ currency }: { currency: string }) {
  const t = useTranslations("costs");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [invalid, setInvalid] = useState(false);
  const save = useSaveRule(() => { setLabel(""); setAmount(""); });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const a = decimal(amount);
    const bad = !AMOUNT.test(a) || !label.trim();
    setInvalid(bad);
    if (!bad) save.mutate({ kind: "fixed_monthly", amount: a, scope: { label: label.trim() } });
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2" noValidate aria-label={t("monthly.add")}>
      <Field label={t("monthly.label")} hint={t("monthly.labelHint")} value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" maxLength={60} className="w-56" />
      <Field label={`${t("monthly.amount")} (${currency})`} ltr inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-36"
        error={invalid ? t("invalidAmount") : null} />
      <Button type="submit" icon="add" busy={save.isPending} disabled={!amount.trim() || !label.trim()}>{t("monthly.add")}</Button>
    </form>
  );
}

function FxCard({ canEdit, today }: { canEdit: boolean; today: string }) {
  const t = useTranslations("costs.fx");
  const tc = useTranslations("costs");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const fx = useQuery({ queryKey: ["fxRates", user?.uid ?? "", store?.tenantId ?? ""], queryFn: () => ok(api.GET("/v1/fx-rates")) });
  const [quote, setQuote] = useState("");
  const [rate, setRate] = useState("");
  const [day, setDay] = useState(today);
  const [invalid, setInvalid] = useState(false);
  const set = useMutation({
    mutationFn: (v: { day: string; quote: string; rate: string }) => ok(api.PUT("/v1/fx-rates/{day}/{quote}", { params: { path: { day: v.day, quote: v.quote } }, body: { rate: v.rate } })),
    onSuccess: () => { setRate(""); void qc.invalidateQueries({ queryKey: ["fxRates"] }); toast({ message: tc("saved") }); },
  });
  const rows = fx.data?.rates ?? [];
  const chosen = quote || rows[0]?.quote || "";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = decimal(rate);
    const bad = !RATE.test(r) || Number(r) <= 0 || !chosen;
    setInvalid(bad);
    if (!bad) set.mutate({ day, quote: chosen, rate: r });
  };
  return (
    <Card title={t("title")} className="lg:col-span-2">
      <p className="mb-3 text-body-sm text-text-2">{t("body")}</p>
      {fx.isPending ? <SkeletonRows rows={2} label={tc("loading")} /> : fx.data ? (
        <>
          <ul className="mb-4 flex flex-col divide-y divide-line rounded-md border border-line" data-testid="fx-rates">
            {rows.map((r) => (
              <li key={r.quote} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <span className="font-medium">
                  {r.rate ? t.rich("line", { base: fx.data.base, rate: r.rate, quote: r.quote, c: (chunks) => <Bdi code>{chunks}</Bdi> })
                    : <span className="text-text-3">{t("missing")}{" "}<Bdi code>{r.quote}</Bdi></span>}
                </span>
                <span className="flex items-center gap-1.5">
                  {r.source === "manual" ? <Badge tone="info">{t("manual")}</Badge> : null}
                  {r.stale ? <Badge tone="warning">{t("stale")}</Badge> : null}
                  {r.day && r.source !== "missing" ? <span className="text-caption text-text-3"><DateText value={`${r.day}T12:00:00Z`} /></span> : null}
                </span>
              </li>
            ))}
          </ul>
          {canEdit && rows.length ? (
            <form onSubmit={submit} className="flex flex-wrap items-end gap-2" noValidate aria-label={t("set")}>
              <Select label={t("currency")} value={chosen} onChange={(e) => setQuote(e.target.value)} className="w-28">
                {rows.map((r) => <option key={r.quote} value={r.quote}>{r.quote}</option>)}
              </Select>
              <Field label={t("day")} type="date" ltr value={day} max={today} onChange={(e) => setDay(e.target.value)} className="w-44" />
              <Field label={t("rate", { base: fx.data.base })} ltr inputMode="decimal" autoComplete="off" placeholder="0.0205" value={rate} onChange={(e) => setRate(e.target.value)} className="w-36"
                error={invalid ? t("invalid") : null} />
              <Button type="submit" variant="secondary" busy={set.isPending} disabled={!rate.trim()}>{t("set")}</Button>
            </form>
          ) : null}
          {fx.data.feed ? <p className="mt-3 text-caption text-text-3">{fx.data.feed}</p> : null}
        </>
      ) : <Alert tone="danger">{tc("loadFailed")}</Alert>}
    </Card>
  );
}
