"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonGroup, IconButton } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Choice";
import { Field, Select } from "@/components/ui/Field";
import { Card, EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { SettingsTabs } from "./SettingsTabs";

type Settings = Schemas["ConfirmationSettings"];
type Step = Settings["steps"][number];
type Channel = Step["channel"];
const CHANNELS: readonly Channel[] = ["whatsapp", "sms", "voice"];
const EDITORS = new Set(["owner", "admin", "ops_manager"]);
const MAX_STEPS = 6;

/**
 * Settings → Confirmation (M2, E6-7): turn automatic confirmation on or off, the order of the
 * channels and how long to wait for each, calling hours, and how long the customer's link works.
 */
export function ConfirmationSettingsScreen() {
  const t = useTranslations("confirmationSettings");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = EDITORS.has(store?.role ?? "");
  const query = useQuery({
    queryKey: ["confirmationSettings", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/settings/confirmation")),
    enabled: Boolean(store) && canEdit,
  });
  const [draft, setDraft] = useState<Settings | null>(null);
  const save = useMutation({
    mutationFn: (body: Settings) => ok(api.PUT("/v1/settings/confirmation", { body })),
    onSuccess: (r) => { qc.setQueryData(["confirmationSettings", user?.uid ?? "", store?.tenantId ?? ""], r); setDraft(null); toast({ message: t("saved") }); },
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
  if (query.isPending) return frame(<div className="mz-card"><SkeletonRows rows={5} label={t("loading")} /></div>);
  if (query.isError) return frame(<Alert tone="danger">{t("loadFailed")}</Alert>);

  const { channels } = query.data;
  const s = draft ?? query.data.settings;
  const edit = (next: Partial<Settings>) => setDraft({ ...s, ...next });
  const setStep = (i: number, next: Partial<Step>) => edit({ steps: s.steps.map((st, j) => (j === i ? { ...st, ...next } : st)) });
  const anyChannel = channels.whatsapp || channels.sms || channels.voice;
  const hoursValid = s.callingHours.start < s.callingHours.end;

  return frame(
    <>
      <Card>
        <Switch label={t("enabled")} description={t("enabledHint")} checked={s.enabled} onChange={(e) => edit({ enabled: e.target.checked })} />
      </Card>

      <Card title={t("channels.title")}>
        <ul className="flex flex-wrap gap-2" data-testid="confirmation-channels">
          {CHANNELS.map((c) => (
            <li key={c}><Badge tone={channels[c] ? "success" : "neutral"}>{t(`channel.${c}`)}{" · "}{t(channels[c] ? "channels.connected" : "channels.notConnected")}</Badge></li>
          ))}
        </ul>
        {!anyChannel ? <p className="mt-3 text-body-sm text-text-2">{t("channels.none")}</p> : null}
      </Card>

      <Card title={t("steps.title")}>
        <p className="mb-3 text-body-sm text-text-2">{t("steps.body")}</p>
        <ol className="flex flex-col gap-3">
          {s.steps.map((st, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2">
              <span className="mb-2 w-6 text-center font-medium text-text-2" aria-hidden="true">{i + 1}</span>
              <Select label={t("steps.channel")} value={st.channel} onChange={(e) => setStep(i, { channel: e.target.value as Channel })} className="w-44">
                {CHANNELS.map((c) => <option key={c} value={c}>{t(`channel.${c}`)}</option>)}
              </Select>
              <Field label={t("steps.wait")} type="number" ltr min={10} max={1440} step={10} value={st.waitMinutes} className="w-32"
                onChange={(e) => setStep(i, { waitMinutes: Number(e.target.value) })} />
              <IconButton icon="delete" label={t("steps.remove")} onClick={() => edit({ steps: s.steps.filter((_, j) => j !== i) })} />
            </li>
          ))}
          <li className="flex items-center gap-2 text-body-sm text-text-2">
            <Icon name="customer" size={16} />{t("steps.agent")}
          </li>
        </ol>
        {s.steps.length < MAX_STEPS ? (
          <div className="mt-3"><Button variant="secondary" size="sm" icon="add" onClick={() => edit({ steps: [...s.steps, { channel: "sms", waitMinutes: 120 }] })}>{t("steps.add")}</Button></div>
        ) : null}
      </Card>

      <Card title={t("hours.title")}>
        <p className="mb-3 text-body-sm text-text-2">{t("hours.body")}</p>
        <div className="flex flex-wrap gap-3">
          <Field label={t("hours.start")} type="time" ltr value={s.callingHours.start} onChange={(e) => edit({ callingHours: { ...s.callingHours, start: e.target.value } })} className="w-36"
            error={hoursValid ? null : t("hours.invalid")} />
          <Field label={t("hours.end")} type="time" ltr value={s.callingHours.end} onChange={(e) => edit({ callingHours: { ...s.callingHours, end: e.target.value } })} className="w-36" />
          <Field label={t("link.hours")} hint={t("link.hint")} type="number" ltr min={6} max={168} value={s.linkHours} onChange={(e) => edit({ linkHours: Number(e.target.value) })} className="w-36" />
        </div>
      </Card>

      <ButtonGroup>
        <Button busy={save.isPending} disabled={!draft || !hoursValid} onClick={() => save.mutate(s)}>{t("save")}</Button>
        {draft ? <Button variant="ghost" onClick={() => setDraft(null)}>{t("discard")}</Button> : null}
      </ButtonGroup>
    </>,
  );
}
