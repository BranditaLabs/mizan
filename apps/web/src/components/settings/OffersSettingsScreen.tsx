"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonGroup } from "@/components/ui/Button";
import { Checkbox, Switch } from "@/components/ui/Choice";
import { Combobox } from "@/components/ui/Combobox";
import { Field, Select } from "@/components/ui/Field";
import { StatCard } from "@/components/ui/StatCard";
import { Card, EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { MoneyText } from "@/components/ui/Values";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { SettingsTabs } from "./SettingsTabs";

type Settings = Schemas["OfferSettings"];
const EDITORS = new Set(["owner", "admin", "ops_manager"]);
const MODES: readonly Settings["mode"][] = ["rules_then_auto", "rules", "auto"];
const ANY = "any";

/**
 * Settings → Offers (M2, E6-11): offer one more item when a customer confirms. On or off, the
 * owner's rules or Mizan's recommendations (bought together), discount caps, where the offer shows
 * (the WhatsApp chat, the team's call script), the rules, and what offers brought in.
 */
export function OffersSettingsScreen() {
  const t = useTranslations("offersSettings");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = EDITORS.has(store?.role ?? "");
  const scope = [user?.uid ?? "", store?.tenantId ?? ""];
  const settings = useQuery({ queryKey: ["offerSettings", ...scope], queryFn: () => ok(api.GET("/v1/settings/offers")), enabled: Boolean(store) && canEdit });
  const summary = useQuery({ queryKey: ["offerSummary", ...scope], queryFn: () => ok(api.GET("/v1/offers/summary", { params: { query: { days: 30 } } })), enabled: Boolean(store) && canEdit });
  const [draft, setDraft] = useState<Settings | null>(null);
  const save = useMutation({
    mutationFn: (body: Settings) => ok(api.PUT("/v1/settings/offers", { body })),
    onSuccess: (r) => { qc.setQueryData(["offerSettings", ...scope], r); setDraft(null); toast({ message: t("saved") }); },
  });

  const frame = (body: React.ReactNode) => (
    <div className="mx-auto flex max-w-[860px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6">
      <SettingsTabs />
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {body}
    </div>
  );
  if (!canEdit) return frame(<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>);
  if (settings.isPending) return frame(<div className="mz-card"><SkeletonRows rows={5} label={t("loading")} /></div>);
  if (settings.isError) return frame(<Alert tone="danger">{t("loadFailed")}</Alert>);

  const s = draft ?? settings.data;
  const edit = (next: Partial<Settings>) => setDraft({ ...s, ...next });
  const pctValid = (v: string) => /^\d{1,2}(\.\d{1,2})?$/.test(v) && Number(v) <= 50;
  const valid = pctValid(s.maxDiscountPct) && pctValid(s.autoDiscountPct) && Number(s.autoDiscountPct) <= Number(s.maxDiscountPct);
  const sum = summary.data;

  return frame(
    <>
      <Card>
        <Switch label={t("enabled")} description={t("enabledHint")} checked={s.enabled} onChange={(e) => edit({ enabled: e.target.checked })} />
      </Card>

      {sum ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="offer-summary">
          <StatCard label={t("summary.offered")} value={sum.offered} period={t("summary.period", { days: sum.days })} />
          <StatCard label={t("summary.accepted")} value={sum.accepted} period={sum.offered ? t("summary.rate", { pct: Math.round((sum.accepted / sum.offered) * 100) }) : t("summary.period", { days: sum.days })} />
          <StatCard label={t("summary.added")} value={sum.added.length ? <span className="flex flex-col">{sum.added.map((m) => <MoneyText key={m.currency} money={m} />)}</span> : <MoneyText money={{ amount: "0.00", currency: "EGP" }} />} />
        </div>
      ) : null}

      <Card title={t("how.title")}>
        <div className="flex flex-col gap-4">
          <Select label={t("how.mode")} value={s.mode} onChange={(e) => edit({ mode: e.target.value as Settings["mode"] })} className="max-w-md">
            {MODES.map((m) => <option key={m} value={m}>{t(`mode.${m}`)}</option>)}
          </Select>
          <div className="flex flex-wrap gap-3">
            <Field label={t("how.maxDiscount")} hint={t("how.maxDiscountHint")} ltr inputMode="decimal" value={s.maxDiscountPct} className="w-44"
              error={pctValid(s.maxDiscountPct) ? null : t("how.pctInvalid")} onChange={(e) => edit({ maxDiscountPct: e.target.value.trim() })} />
            <Field label={t("how.autoDiscount")} hint={t("how.autoDiscountHint")} ltr inputMode="decimal" value={s.autoDiscountPct} className="w-44"
              error={!pctValid(s.autoDiscountPct) ? t("how.pctInvalid") : Number(s.autoDiscountPct) > Number(s.maxDiscountPct) ? t("how.overMax") : null}
              onChange={(e) => edit({ autoDiscountPct: e.target.value.trim() })} />
          </div>
          <div className="flex flex-col gap-2">
            <Checkbox label={t("how.inWhatsApp")} checked={s.inWhatsApp} onChange={(e) => edit({ inWhatsApp: e.target.checked })} />
            <Checkbox label={t("how.inCalls")} checked={s.inCalls} onChange={(e) => edit({ inCalls: e.target.checked })} />
          </div>
          <p className="text-caption text-text-3">{t("how.guards")}</p>
        </div>
      </Card>

      <ButtonGroup>
        <Button busy={save.isPending} disabled={!draft || !valid} onClick={() => save.mutate(s)}>{t("save")}</Button>
        {draft ? <Button variant="ghost" onClick={() => setDraft(null)}>{t("discard")}</Button> : null}
      </ButtonGroup>

      <Rules />
    </>,
  );
}

/** The owner's rules: when the order has [a product or anything] → offer [a product] at X% off. */
function Rules() {
  const t = useTranslations("offersSettings.rules");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const scope = [user?.uid ?? "", store?.tenantId ?? ""];
  const rules = useQuery({ queryKey: ["offerRules", ...scope], queryFn: () => ok(api.GET("/v1/offer-rules")), enabled: Boolean(store) });
  const products = useQuery({ queryKey: ["offerProducts", ...scope], queryFn: () => ok(api.GET("/v1/offer-products")), enabled: Boolean(store) });
  const [form, setForm] = useState({ trigger: ANY, offer: "", discountPct: "10", messageAr: "" });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["offerRules"] });
  const add = useMutation({
    mutationFn: () => ok(api.POST("/v1/offer-rules", { body: {
      triggerVariantId: form.trigger === ANY ? null : form.trigger, offerVariantId: form.offer, discountPct: form.discountPct, priority: 0,
      ...(form.messageAr.trim() ? { messageAr: form.messageAr.trim() } : {}),
    } })),
    onSuccess: () => { setForm({ trigger: ANY, offer: "", discountPct: "10", messageAr: "" }); toast({ message: t("added") }); refresh(); },
  });
  const toggle = useMutation({
    mutationFn: (r: { id: string; active: boolean }) => ok(api.PATCH("/v1/offer-rules/{id}", { params: { path: { id: r.id } }, body: { active: r.active } })),
    onSuccess: refresh,
  });

  const options = (products.data?.data ?? []).map((p) => ({ value: p.variantId, label: p.title, hint: p.sku }));
  const canAdd = Boolean(form.offer) && form.offer !== form.trigger && /^\d{1,2}(\.\d{1,2})?$/.test(form.discountPct) && Number(form.discountPct) <= 50;
  return (
    <Card title={t("title")}>
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-text-2">{t("body")}</p>
        {rules.data?.data.length ? (
          <ul className="flex flex-col divide-y divide-line" data-testid="offer-rules">
            {rules.data.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="text-body-sm">
                  {t.rich("line", { trigger: r.trigger?.title ?? t("anyOrder"), offer: r.offer.title, pct: r.discountPct, b: (c) => <strong>{c}</strong>, n: (c) => <bdi dir="ltr" className="mz-num">{c}</bdi> })}
                </span>
                {!r.active ? <Badge tone="neutral">{t("stopped")}</Badge> : null}
                <Button size="sm" variant="ghost" className="ms-auto" busy={toggle.isPending && toggle.variables?.id === r.id} onClick={() => toggle.mutate({ id: r.id, active: !r.active })}>
                  {t(r.active ? "stop" : "start")}
                </Button>
              </li>
            ))}
          </ul>
        ) : <p className="text-body-sm text-text-3">{t("none")}</p>}

        <form className="flex flex-col gap-3 rounded-md border border-line p-3" onSubmit={(e) => { e.preventDefault(); if (canAdd) add.mutate(); }}>
          <h3 className="font-medium">{t("new")}</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Combobox label={t("when")} options={[{ value: ANY, label: t("anyOrder") }, ...options]} value={form.trigger} onChange={(v) => setForm({ ...form, trigger: v })} emptyText={t("noProducts")} />
            <Combobox label={t("offer")} options={options} value={form.offer || null} onChange={(v) => setForm({ ...form, offer: v })} emptyText={t("noProducts")} placeholder={t("offerPlaceholder")} />
          </div>
          <div className="flex flex-wrap gap-3">
            <Field label={t("discount")} ltr inputMode="decimal" value={form.discountPct} className="w-36" onChange={(e) => setForm({ ...form, discountPct: e.target.value.trim() })} />
            <Field label={t("message")} hint={t("messageHint")} maxLength={300} value={form.messageAr} className="min-w-64 flex-1" onChange={(e) => setForm({ ...form, messageAr: e.target.value })} />
          </div>
          <div><Button type="submit" size="sm" icon="add" disabled={!canAdd} busy={add.isPending}>{t("add")}</Button></div>
        </form>
      </div>
    </Card>
  );
}
