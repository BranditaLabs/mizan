"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Bdi } from "@/components/Bdi";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { KeyValue, SkeletonRows } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { ok } from "@/lib/api/client";
import { queryKeys, useSession } from "@/lib/session";
import { SettingsTabs } from "./SettingsTabs";

const EDITORS = new Set(["owner", "admin"]);
/** The time zones of the markets Mizan serves; the store's own is always offered. */
const ZONES = ["Africa/Cairo", "Asia/Riyadh", "Asia/Dubai", "Asia/Kuwait", "Asia/Qatar", "Asia/Bahrain", "Asia/Muscat", "Asia/Amman", "Africa/Casablanca"];

/**
 * Settings → Store (A-8): the store's name, time zone (where a day starts for reports and usage)
 * and the language of customer messages. Country and currency stay as signed up. Everyone sees it;
 * owners and admins change it.
 */
export function StoreProfileScreen() {
  const t = useTranslations("storeProfile");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const uid = user?.uid ?? "";
  const tenantId = store?.tenantId ?? "";
  const q = useQuery({ queryKey: queryKeys.tenant(uid, tenantId), queryFn: () => ok(api.GET("/v1/tenant")), enabled: Boolean(store) });
  const [draft, setDraft] = useState<{ name?: string; timezone?: string; locale?: string }>({});
  const editable = EDITORS.has(store?.role ?? "");
  const save = useMutation({
    mutationFn: () => ok(api.PATCH("/v1/tenant", { body: draft })),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.tenant(uid, tenantId), data);
      void qc.invalidateQueries({ queryKey: queryKeys.me(uid) }); // the store switcher shows the name
      setDraft({});
      toast({ message: t("saved") });
    },
  });
  const s = q.data;
  const value = <K extends keyof typeof draft>(k: K) => draft[k] ?? (s ? s[k] : "") ?? "";
  const dirty = s ? Object.entries(draft).some(([k, v]) => v !== s[k as keyof typeof draft]) : false;
  const onSubmit = (e: FormEvent) => { e.preventDefault(); if (dirty) save.mutate(); };

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="store-profile">
      <SettingsTabs />
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {!s ? <div className="mz-card"><SkeletonRows rows={3} label={t("loading")} /></div> : (
        <div className="grid gap-5 md:grid-cols-3">
          <form onSubmit={onSubmit} className="mz-card flex flex-col gap-4 p-5 md:col-span-2" noValidate>
            <Field label={t("name")} name="name" value={value("name")} maxLength={80} disabled={!editable} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <Select label={t("timezone")} hint={t("timezoneHint")} value={value("timezone")} disabled={!editable} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}>
              {[...new Set([s.timezone, ...ZONES])].map((z) => <option key={z} value={z}>{t.has(`zones.${z.replace("/", "_")}`) ? t(`zones.${z.replace("/", "_")}` as "zones.Africa_Cairo") : z}</option>)}
            </Select>
            <Select label={t("locale")} hint={t("localeHint")} value={value("locale")} disabled={!editable} onChange={(e) => setDraft({ ...draft, locale: e.target.value })}>
              {[`ar-${s.country}`, `en-${s.country}`].map((l) => <option key={l} value={l}>{t(`locales.${l.slice(0, 2)}` as "locales.ar")}</option>)}
            </Select>
            {editable ? <div><Button type="submit" busy={save.isPending} disabled={!dirty || value("name").trim().length < 2}>{t("save")}</Button></div> : <p className="text-caption text-text-2">{t("readOnly")}</p>}
          </form>
          <div className="mz-card p-5">
            <KeyValue items={[
              { label: t("country"), value: <Bdi>{s.country}</Bdi> },
              { label: t("currency"), value: <Bdi>{s.baseCurrency}</Bdi> },
              { label: t("address"), value: <Bdi code>{s.slug}</Bdi> },
            ]} />
            <p className="mt-3 text-caption text-text-2">{t("fixed")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
