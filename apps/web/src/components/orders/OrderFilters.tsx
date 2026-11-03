"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Choice";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select } from "@/components/ui/Field";
import { ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { FILTER_KEYS, MODES, type ListFilters, type Mode } from "./order-filters";


type View = Schemas["SavedView"];
const LEADS = new Set(["owner", "admin", "ops_manager"]);

/**
 * O2: the list's filters (tag, city, courier, payment, dates; a product from its page) and saved
 * views — the person's own, and the team's shared ones that the owner, an admin or the ops
 * manager made. Choosing a view applies its tab, search and filters.
 */
export function OrderFilters({ value, onChange, current, onView }: {
  value: ListFilters; onChange(f: ListFilters): void;
  /** What a new view keeps: the tab, search and filters as the API takes them. */
  current: View["filters"];
  onView(v: View): void;
}) {
  const t = useTranslations("orders.filters");
  const tm = useTranslations("payments.mode");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const [viewId, setViewId] = useState("");
  const [saving, setSaving] = useState(false);
  const scope = [user?.uid ?? "", store?.tenantId ?? ""];
  const facets = useQuery({ queryKey: ["order-filters", ...scope], queryFn: () => ok(api.GET("/v1/orders/filters")), enabled: Boolean(store), meta: { toast: false }, staleTime: 60_000 });
  const views = useQuery({ queryKey: ["order-views", ...scope], queryFn: () => ok(api.GET("/v1/orders/views")), enabled: Boolean(store), meta: { toast: false } });
  const remove = useMutation({
    mutationFn: (id: string) => ok(api.DELETE("/v1/orders/views/{viewId}", { params: { path: { viewId: id } } })),
    onSuccess: async () => { setViewId(""); await qc.invalidateQueries({ queryKey: ["order-views"] }); },
  });
  const set = (patch: ListFilters) => { setViewId(""); onChange({ ...value, ...patch }); };
  const any = FILTER_KEYS.some((k) => value[k]);
  const f = facets.data;
  const chosen = views.data?.data.find((v) => v.id === viewId);
  const canRemove = chosen && (chosen.mine || LEADS.has(store?.role ?? ""));

  return (
    <section aria-label={t("label")} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Select label={t("view")} value={viewId} className="w-full sm:w-56"
          onChange={(e) => { const v = views.data?.data.find((x) => x.id === e.target.value); setViewId(e.target.value); if (v) onView(v); }}>
          <option value="">{t("noView")}</option>
          {(views.data?.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.shared ? t("sharedName", { name: v.name }) : v.name}</option>)}
        </Select>
        <Select label={t("tag")} value={value.tag ?? ""} onChange={(e) => set({ tag: e.target.value || undefined })} className="w-full sm:w-44">
          <option value="">{t("any")}</option>
          {(f?.tags ?? []).map((x) => <option key={x.value} value={x.value}>{x.value}</option>)}
          {value.tag && !f?.tags.some((x) => x.value === value.tag) ? <option value={value.tag}>{value.tag}</option> : null}
        </Select>
        <Select label={t("city")} value={value.city ?? ""} onChange={(e) => set({ city: e.target.value || undefined })} className="w-full sm:w-44">
          <option value="">{t("any")}</option>
          {(f?.cities ?? []).map((x) => <option key={x.value} value={x.value}>{x.value}</option>)}
          {value.city && !f?.cities.some((x) => x.value.toLowerCase() === value.city?.toLowerCase()) ? <option value={value.city}>{value.city}</option> : null}
        </Select>
        <Select label={t("courier")} value={value.courierId ?? ""} onChange={(e) => set({ courierId: e.target.value || undefined })} className="w-full sm:w-44">
          <option value="">{t("any")}</option>
          {(f?.couriers ?? []).map((x) => <option key={x.id} value={x.id}>{x.name ?? x.provider}</option>)}
        </Select>
        <Select label={t("payment")} value={value.paymentMode ?? ""} onChange={(e) => set({ paymentMode: (e.target.value || undefined) as Mode | undefined })} className="w-full sm:w-44">
          <option value="">{t("any")}</option>
          {MODES.map((m) => <option key={m} value={m}>{tm(m)}</option>)}
        </Select>
        <Field label={t("from")} type="date" ltr value={value.from ?? ""} max={value.to} onChange={(e) => set({ from: e.target.value || undefined })} className="w-full sm:w-40" />
        <Field label={t("to")} type="date" ltr value={value.to ?? ""} min={value.from} onChange={(e) => set({ to: e.target.value || undefined })} className="w-full sm:w-40" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {value.productId ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-sunk px-3 py-1 text-body-sm" data-testid="product-filter">
            {t("oneProduct")}
            <Button size="sm" variant="ghost" icon="close" onClick={() => set({ productId: undefined })}>{t("clearOne")}</Button>
          </span>
        ) : null}
        {any ? <Button size="sm" variant="ghost" onClick={() => { setViewId(""); onChange({}); }}>{t("clear")}</Button> : null}
        <Button size="sm" variant="secondary" icon="starred" onClick={() => setSaving(true)}>{t("save")}</Button>
        {canRemove ? <Button size="sm" variant="ghost" icon="delete" busy={remove.isPending} onClick={() => remove.mutate(chosen.id)}>{t("removeView")}</Button> : null}
      </div>
      {saving ? <SaveViewDialog filters={current} onClose={() => setSaving(false)} onSaved={(v) => { setSaving(false); setViewId(v.id); }} /> : null}
    </section>
  );
}

function SaveViewDialog({ filters, onClose, onSaved }: { filters: View["filters"]; onClose(): void; onSaved(v: View): void }) {
  const t = useTranslations("orders.filters");
  const tpr = useTranslations("problems");
  const { api, store } = useSession();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const save = useMutation({
    mutationFn: () => ok(api.POST("/v1/orders/views", { body: { name: name.trim(), filters, shared } })),
    onSuccess: async (v) => { await qc.invalidateQueries({ queryKey: ["order-views"] }); onSaved(v); },
    meta: { toast: false },
  });
  return (
    <Dialog open onClose={onClose} title={t("saveTitle")} description={t("saveBody")}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t("cancel")}</Button>
          <Button busy={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>{t("saveConfirm")}</Button>
        </>
      )}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(); }}>
        <Field label={t("name")} value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} />
        {LEADS.has(store?.role ?? "") ? <Switch label={t("shared")} description={t("sharedHint")} checked={shared} onChange={(e) => setShared(e.target.checked)} /> : null}
        {save.isError ? <Alert tone="danger">{problemText(save.error, tpr)}</Alert> : null}
      </form>
    </Dialog>
  );
}
