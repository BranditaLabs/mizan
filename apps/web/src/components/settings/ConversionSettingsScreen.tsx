"use client";

import { rolesWith } from "@mizan/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { SaveBar } from "@/components/ui/SaveBar";
import { Field } from "@/components/ui/Field";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { Pending } from "@/components/ui/QueryState";
import { useToast } from "@/components/ui/Toast";
import { ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { latin } from "@/lib/rich";

type S = Schemas["ConversionSettings"];
const READERS = rolesWith("payments.settings.read");
const EDITORS = rolesWith("payments.settings");
const METHODS = ["instapay", "wallet", "bank_transfer", "link"] as const;

/** Settings → Payments (E14-3): where customers pay when a COD order is converted, the deposit share and how long an offer stays open. */
export function ConversionSettingsScreen() {
  const t = useTranslations("conversionSettings");
  const tc = useTranslations("conversion");
  const tpr = useTranslations("problems");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const role = store?.role ?? "";
  const q = useQuery({ queryKey: ["conversionSettings", user?.uid ?? "", store?.tenantId ?? ""], queryFn: () => ok(api.GET("/v1/settings/conversion")), enabled: READERS.has(role) });
  const [draft, setDraft] = useState<Partial<{ depositPct: string; expiresHours: string } & Record<(typeof METHODS)[number], string>>>({});
  const v = (k: keyof typeof draft) => draft[k] ?? (k === "depositPct" || k === "expiresHours" ? String(q.data?.[k] ?? "") : (q.data?.methods[k as (typeof METHODS)[number]] ?? ""));
  const numbersOk = /^\d{1,3}$/.test(v("depositPct")) && /^\d{1,3}$/.test(v("expiresHours"));
  const save = useMutation({
    mutationFn: () => {
      const methods: S["methods"] = {};
      for (const m of METHODS) if (v(m).trim()) methods[m] = v(m).trim();
      return ok(api.PUT("/v1/settings/conversion", { body: { depositPct: Number(v("depositPct")), expiresHours: Number(v("expiresHours")), methods } }));
    },
    meta: { toast: false },
    onSuccess: () => { toast.event({ type: null, message: t("saved") }); setDraft({}); void qc.invalidateQueries({ queryKey: ["conversionSettings"] }); void qc.invalidateQueries({ queryKey: ["conversion"] }); },
  });
  const editor = EDITORS.has(role);
  const body = !READERS.has(role) ? <div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>
    : !q.data ? <div className="mz-card"><Pending query={q}><SkeletonRows rows={3} label={t("loading")} /></Pending></div>
    : (
      <form className="mz-card flex max-w-[640px] flex-col gap-3 p-5" onSubmit={(e) => { e.preventDefault(); if (editor && numbersOk) save.mutate(); }}>
        <h2 className="text-heading-sm">{t("methodsTitle")}</h2>
        <p className="text-body-sm text-text-2">{t("methodsHint")}</p>
        {METHODS.map((m) => (
          <Field key={m} label={tc(`method.${m}`)} hint={t.rich(`hints.${m}`, latin)} ltr={m !== "bank_transfer"} disabled={!editor} value={v(m)} onChange={(e) => setDraft({ ...draft, [m]: e.target.value })} />
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("depositPct")} inputMode="numeric" ltr disabled={!editor} value={v("depositPct")} onChange={(e) => setDraft({ ...draft, depositPct: e.target.value.trim() })} />
          <Field label={t("expiresHours")} inputMode="numeric" ltr disabled={!editor} value={v("expiresHours")} onChange={(e) => setDraft({ ...draft, expiresHours: e.target.value.trim() })} />
        </div>
        {save.isError ? <Alert tone="danger">{problemText(save.error, tpr)}</Alert> : null}
        {editor ? <SaveBar dirty={Object.keys(draft).length > 0} busy={save.isPending} canSave={numbersOk} onSave={() => save.mutate()} onDiscard={() => setDraft({})} /> : null}
      </form>
    );
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="conversion-settings">
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {body}
    </div>
  );
}
