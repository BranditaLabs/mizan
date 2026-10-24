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
import { ConfirmationResults } from "./ConfirmationResults";
import { SettingsTabs } from "./SettingsTabs";

type Settings = Schemas["ConfirmationSettings"];
type Step = Settings["steps"][number];
type Channel = Step["channel"];
const CHANNELS: readonly Channel[] = ["whatsapp", "call_auto", "call_team"];
const EDITORS = new Set(["owner", "admin", "ops_manager"]);
const MAX_STEPS = 6;

/**
 * Settings → Confirmation (M2, E6-7, E6-10): turn automatic confirmation on or off, the store's
 * WhatsApp number, the order of the channels (WhatsApp, automated call, our team calls) and how long
 * to wait for each, team-call retries, calling hours, how long a hand-sent link works, and the results (E6-6).
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
  const hoursValid = s.callingHours.start < s.callingHours.end;
  const teamLast = s.steps.findIndex((x) => x.channel === "call_team");
  const stepsValid = s.steps.length > 0 && (teamLast === -1 || teamLast === s.steps.length - 1);
  const rt = s.routing;
  const routingValid = rt.autoMax <= rt.botMax && rt.botMax <= rt.agentMax;
  const setRouting = (next: Partial<Settings["routing"]>) => edit({ routing: { ...rt, ...next } });
  const threshold = (v: string) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  /** A new step goes before the team call, which stays last. */
  const addStep = () => {
    const step: Step = { channel: channels.call_auto ? "call_auto" : "whatsapp", waitMinutes: 60 };
    edit({ steps: teamLast === -1 ? [...s.steps, step] : [...s.steps.slice(0, teamLast), step, ...s.steps.slice(teamLast)] });
  };

  return frame(
    <>
      <Card>
        <Switch label={t("enabled")} description={t("enabledHint")} checked={s.enabled} onChange={(e) => edit({ enabled: e.target.checked })} />
      </Card>

      <ConfirmationResults />

      <Card title={t("channels.title")}>
        <ul className="flex flex-wrap gap-2" data-testid="confirmation-channels">
          {(["whatsapp", "call_auto"] as const).map((c) => (
            <li key={c}><Badge tone={channels[c] ? "success" : "neutral"}>{t(`channel.${c}`)}{" · "}{t(channels[c] ? "channels.connected" : "channels.notConnected")}</Badge></li>
          ))}
          <li><Badge tone="success">{t("channel.call_team")}{" · "}{t("channels.always")}</Badge></li>
        </ul>
        {!channels.whatsapp ? <p className="mt-3 text-body-sm text-text-2">{t("channels.none")}</p> : null}
      </Card>

      <WhatsAppConnect />

      <Card title={t("steps.title")}>
        <p className="mb-3 text-body-sm text-text-2">{t("steps.body")}</p>
        <ol className="flex flex-col gap-3">
          {s.steps.map((st, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2">
              <span className="mb-2 w-6 text-center font-medium text-text-2" aria-hidden="true">{i + 1}</span>
              <Select label={t("steps.channel")} value={st.channel} onChange={(e) => setStep(i, { channel: e.target.value as Channel })} className="w-48">
                {CHANNELS.map((c) => <option key={c} value={c}>{t(`channel.${c}`)}</option>)}
              </Select>
              <Field label={t("steps.wait")} type="number" ltr min={10} max={1440} step={10} value={st.waitMinutes} className="w-32"
                onChange={(e) => setStep(i, { waitMinutes: Number(e.target.value) })} />
              <IconButton icon="delete" label={t("steps.remove")} onClick={() => edit({ steps: s.steps.filter((_, j) => j !== i) })} />
            </li>
          ))}
          {teamLast === -1 ? (
            <li className="flex items-center gap-2 text-body-sm text-text-2">
              <Icon name="customer" size={16} />{t("steps.agent")}
            </li>
          ) : null}
        </ol>
        {!stepsValid ? <p className="mt-2 text-body-sm text-danger" role="alert">{t("steps.teamLast")}</p> : null}
        {s.steps.length < MAX_STEPS ? (
          <div className="mt-3"><Button variant="secondary" size="sm" icon="add" onClick={addStep}>{t("steps.add")}</Button></div>
        ) : null}
      </Card>

      <Card title={t("routing.title")}>
        <div className="flex flex-col gap-3" data-testid="routing">
          <Switch label={t("routing.enabled")} description={t("routing.enabledHint")} checked={rt.enabled} onChange={(e) => setRouting({ enabled: e.target.checked })} />
          {rt.enabled ? (
            <>
              <div className="flex flex-wrap gap-3">
                <Field label={t("routing.autoMax")} hint={t("routing.autoMaxHint")} type="number" ltr min={0} max={100} value={rt.autoMax} className="w-44" onChange={(e) => setRouting({ autoMax: threshold(e.target.value) })} />
                <Field label={t("routing.botMax")} hint={t("routing.botMaxHint")} type="number" ltr min={0} max={100} value={rt.botMax} className="w-44" onChange={(e) => setRouting({ botMax: threshold(e.target.value) })} />
                <Field label={t("routing.agentMax")} hint={t("routing.agentMaxHint")} type="number" ltr min={0} max={100} value={rt.agentMax} className="w-44"
                  error={routingValid ? null : t("routing.order")} onChange={(e) => setRouting({ agentMax: threshold(e.target.value) })} />
              </div>
              <p className="text-caption text-text-3">{t("routing.paid")}</p>
            </>
          ) : null}
        </div>
      </Card>

      <Card title={t("team.title")}>
        <p className="mb-3 text-body-sm text-text-2">{t("team.body")}</p>
        <div className="flex flex-wrap gap-3">
          <Field label={t("team.attempts")} type="number" ltr min={1} max={10} value={s.teamCalls.attempts} className="w-36"
            onChange={(e) => edit({ teamCalls: { ...s.teamCalls, attempts: Number(e.target.value) } })} />
          <Field label={t("team.retry")} type="number" ltr min={10} max={1440} step={10} value={s.teamCalls.retryMinutes} className="w-44"
            onChange={(e) => edit({ teamCalls: { ...s.teamCalls, retryMinutes: Number(e.target.value) } })} />
        </div>
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
        <Button busy={save.isPending} disabled={!draft || !hoursValid || !stepsValid || !routingValid} onClick={() => save.mutate(s)}>{t("save")}</Button>
        {draft ? <Button variant="ghost" onClick={() => setDraft(null)}>{t("discard")}</Button> : null}
      </ButtonGroup>
    </>,
  );
}

const WA_REASONS = ["token_refused", "token_lacks_permission", "template_pending", "template_rejected", "template_missing"] as const;

/**
 * The store's WhatsApp number (E6-10): the ids and token from Meta, stored encrypted and checked in
 * the background (the token works, the confirmation template is approved). Owner and admin connect;
 * ops managers see the status and can ask for a new check.
 */
function WhatsAppConnect() {
  const t = useTranslations("confirmationSettings.whatsapp");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const canConnect = store?.role === "owner" || store?.role === "admin";
  const key = ["connections", user?.uid ?? "", store?.tenantId ?? ""];
  const list = useQuery({ queryKey: key, queryFn: () => ok(api.GET("/v1/connections")), enabled: Boolean(store), refetchInterval: (q) => (q.state.data?.data.some((c) => c.kind === "whatsapp" && c.status === "pending") ? 5_000 : false) });
  const [form, setForm] = useState({ phoneNumberId: "", wabaId: "", accessToken: "" });
  const [editing, setEditing] = useState(false);
  const done = () => { void qc.invalidateQueries({ queryKey: ["connections"] }); void qc.invalidateQueries({ queryKey: ["confirmationSettings"] }); };
  const connect = useMutation({
    mutationFn: () => ok(api.POST("/v1/connections/whatsapp", { body: form })),
    onSuccess: () => { setForm({ phoneNumberId: "", wabaId: "", accessToken: "" }); setEditing(false); toast({ message: t("saved") }); done(); },
  });
  const check = useMutation({ mutationFn: () => ok(api.POST("/v1/connections/whatsapp/check")), onSuccess: done });

  const wa = list.data?.data.find((c) => c.kind === "whatsapp") ?? null;
  const reason = wa?.reason && (WA_REASONS as readonly string[]).includes(wa.reason) ? (wa.reason as (typeof WA_REASONS)[number]) : null;
  const tone = wa?.status === "active" ? "success" : wa?.status === "needs_attention" ? "danger" : wa?.status === "pending" ? "info" : "neutral";
  const showForm = canConnect && (!wa || editing);
  return (
    <Card title={t("title")} actions={wa ? <Badge tone={tone}>{t(`status.${wa.status}`)}</Badge> : null}>
      <div className="flex flex-col gap-3" data-testid="whatsapp-connect">
        <p className="text-body-sm text-text-2">{t("body")}</p>
        {wa ? (
          <p className="text-body-sm">{t.rich("number", { id: wa.account ?? "", n: (c) => <bdi dir="ltr" className="mz-num">{c}</bdi> })}</p>
        ) : null}
        {wa?.status === "pending" ? <Alert tone="info">{t("checking")}</Alert> : null}
        {reason ? <Alert tone="danger">{t(`reason.${reason}`)}</Alert> : null}
        {showForm ? (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); connect.mutate(); }}>
            <div className="flex flex-wrap gap-3">
              <Field label={t("phoneNumberId")} hint={t("phoneNumberIdHint")} ltr inputMode="numeric" autoComplete="off" required className="w-56"
                value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value.trim() })} />
              <Field label={t("wabaId")} ltr inputMode="numeric" autoComplete="off" required className="w-56"
                value={form.wabaId} onChange={(e) => setForm({ ...form, wabaId: e.target.value.trim() })} />
            </div>
            <Field label={t("token")} hint={t("tokenHint")} ltr type="password" autoComplete="off" required
              value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} />
            <ButtonGroup>
              <Button type="submit" icon="channels" busy={connect.isPending}>{t(wa ? "replace" : "connect")}</Button>
              {wa ? <Button variant="ghost" onClick={() => setEditing(false)}>{t("cancel")}</Button> : null}
            </ButtonGroup>
          </form>
        ) : wa ? (
          <ButtonGroup>
            {wa.status !== "pending" ? <Button size="sm" variant="secondary" icon="refresh" busy={check.isPending} onClick={() => check.mutate()}>{t("check")}</Button> : null}
            {canConnect ? <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(true)}>{t("change")}</Button> : null}
          </ButtonGroup>
        ) : <p className="text-body-sm text-text-3">{t("ownerOnly")}</p>}
      </div>
    </Card>
  );
}
