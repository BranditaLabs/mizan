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

const EDITORS = new Set(["owner", "admin", "ops_manager"]);

/** Settings → Orders (M1, E5-3): how long after one order the same customer's same product is a likely duplicate. */
export function OrderSettingsScreen() {
  const t = useTranslations("orderSettings");
  const tpr = useTranslations("problem");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const allowed = EDITORS.has(store?.role ?? "");
  const q = useQuery({
    queryKey: ["orderSettings", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/settings/orders")),
    enabled: allowed,
  });
  const [value, setValue] = useState<string | null>(null);
  const current = value ?? String(q.data?.duplicateWindowHours ?? "");
  const hours = Number(current);
  const valid = /^\d{1,3}$/.test(current.trim()) && hours >= 0 && hours <= 168;
  const save = useMutation({
    mutationFn: () => ok(api.PUT("/v1/settings/orders", { body: { duplicateWindowHours: hours } })),
    meta: { toast: false },
    onSuccess: () => { toast({ message: t("saved") }); setValue(null); void qc.invalidateQueries({ queryKey: ["orderSettings"] }); },
  });
  const body = !allowed ? <div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>
    : !q.data ? <div className="mz-card"><SkeletonRows rows={2} label={t("loading")} /></div>
    : (
      <form className="mz-card flex max-w-[560px] flex-col gap-3 p-5" data-testid="order-settings-form" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
        <Field label={t("window")} hint={t("windowHint")} inputMode="numeric" ltr value={current}
          error={current.trim() && !valid ? t("windowInvalid") : undefined} onChange={(e) => setValue(e.target.value)} />
        <ul className="list-disc ps-5 text-body-sm text-text-2">
          <li>{t("rules.same")}</li><li>{t("rules.keep")}</li><li>{t("rules.off")}</li><li>{t("rules.from")}</li>
        </ul>
        {save.isError ? <Alert tone="danger">{problemText(save.error, tpr)}</Alert> : null}
        <div><Button type="submit" busy={save.isPending} disabled={!valid}>{t("save")}</Button></div>
      </form>
    );
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="order-settings">
      <SettingsTabs />
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {body}
    </div>
  );
}
