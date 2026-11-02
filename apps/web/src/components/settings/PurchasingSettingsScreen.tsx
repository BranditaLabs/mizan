"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { ok } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { SettingsTabs } from "./SettingsTabs";

const READERS = new Set(["owner", "admin", "ops_manager", "finance"]);
const EDITORS = new Set(["owner", "admin"]);

/** Settings → Purchasing (M16-2): the amount over which a purchase order needs the owner or an admin to approve. */
export function PurchasingSettingsScreen() {
  const t = useTranslations("purchasingSettings");
  const tpr = useTranslations("problem");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const role = store?.role ?? "";
  const q = useQuery({
    queryKey: ["purchasingSettings", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/settings/purchasing")),
    enabled: READERS.has(role),
  });
  const [value, setValue] = useState<string | null>(null);
  const current = value ?? q.data?.approveOver ?? "";
  const [days, setDays] = useState<Partial<Record<"safetyDays" | "targetCoverDays" | "velocityDays", string>>>({});
  const day = (k: "safetyDays" | "targetCoverDays" | "velocityDays") => days[k] ?? String(q.data?.[k] ?? "");
  const daysValid = (["safetyDays", "targetCoverDays", "velocityDays"] as const).every((k) => /^\d{1,3}$/.test(day(k)));
  const save = useMutation({
    mutationFn: () => ok(api.PUT("/v1/settings/purchasing", { body: { approveOver: current.trim(), safetyDays: Number(day("safetyDays")), targetCoverDays: Number(day("targetCoverDays")), velocityDays: Number(day("velocityDays")) } })),
    meta: { toast: false },
    onSuccess: () => { toast({ message: t("saved") }); setValue(null); setDays({}); void qc.invalidateQueries({ queryKey: ["reorder"] }); void qc.invalidateQueries({ queryKey: ["purchasingSettings"] }); void qc.invalidateQueries({ queryKey: ["purchaseOrder"] }); },
  });
  const body = !READERS.has(role) ? <div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>
    : !q.data ? <div className="mz-card"><SkeletonRows rows={2} label={t("loading")} /></div>
    : (
      <form className="mz-card flex max-w-[560px] flex-col gap-3 p-5" onSubmit={(e) => { e.preventDefault(); if (EDITORS.has(role)) save.mutate(); }}>
        <Field label={t("approveOver")} hint={t("approveOverHint")} inputMode="decimal" ltr value={current}
          disabled={!EDITORS.has(role)} onChange={(e) => setValue(e.target.value)} />
        <ul className="list-disc ps-5 text-body-sm text-text-2">
          <li>{t("rules.under")}</li><li>{t("rules.over")}</li><li>{t("rules.foreign")}</li>
        </ul>
        <h2 className="mt-2 text-heading-sm">{t("reorder.title")}</h2>
        <p className="text-body-sm text-text-2">{t("reorder.hint")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(["velocityDays", "safetyDays", "targetCoverDays"] as const).map((k) => (
            <Field key={k} label={t(`reorder.${k}`)} inputMode="numeric" ltr value={day(k)} disabled={!EDITORS.has(role)}
              onChange={(e) => setDays({ ...days, [k]: e.target.value.trim() })} error={/^\d{1,3}$/.test(day(k)) ? null : t("reorder.days")} />
          ))}
        </div>
        {save.isError ? <Alert tone="danger">{problemText(save.error, tpr)}</Alert> : null}
        {EDITORS.has(role) ? <div><Button type="submit" busy={save.isPending} disabled={!current.trim() || !daysValid}>{t("save")}</Button></div> : null}
      </form>
    );
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="purchasing-settings">
      <SettingsTabs />
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {body}
    </div>
  );
}
