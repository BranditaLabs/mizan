"use client";

import { rolesWith, can } from "@mizan/shared";
import { Icon } from "@mizan/design-system/icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonGroup, buttonClass } from "@/components/ui/Button";
import { SaveBar } from "@/components/ui/SaveBar";
import { Switch } from "@/components/ui/Choice";
import { Field, Select } from "@/components/ui/Field";
import { Card, EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { ErrorState } from "@/components/ui/QueryState";
import { useToast } from "@/components/ui/Toast";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { Link } from "@/i18n/navigation";

type Settings = Schemas["ConfirmationSettings"];
type Script = NonNullable<Settings["script"]>;
type Template = NonNullable<Schemas["ConfirmationSettingsView"]["templates"]>[number];
type ArabicChoice = NonNullable<Script["template"]>;
const AR_CHOICES: readonly ArabicChoice[] = ["ar_egyptian", "ar_formal", "ar_gulf"];
const DEFAULT_SCRIPT: Script = { pack: "egyptian", texts: { ar: {}, en: {} } };
const EDITORS = rolesWith("confirmation.manage");

/**
 * Settings → Confirmation (M2, E6-7, E6-10): turn automatic confirmation on or off, the store's
 * WhatsApp number, routing by risk and how long a hand-sent link works. The steps, the team's calls,
 * calling hours and every word of the chat are designed in the studio (E6-16b), linked from here.
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
    // E6-16d: while a submission is on its way (queued or retrying), and while Meta reviews a template, its state is read again now and then.
    refetchInterval: (q) => (q.state.data?.templates?.some((x) => x.submitting) ? 10_000 : q.state.data?.templates?.some((x) => x.status === "PENDING") ? 30_000 : false),
  });
  const [draft, setDraft] = useState<Settings | null>(null);
  const save = useMutation({
    mutationFn: (body: Settings) => ok(api.PUT("/v1/settings/confirmation", { body })),
    onSuccess: (r) => { qc.setQueryData(["confirmationSettings", user?.uid ?? "", store?.tenantId ?? ""], r); setDraft(null); toast({ message: t("saved") }); },
  });

  const frame = (body: React.ReactNode) => (
    <div className="flex min-w-0 flex-col gap-5">
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
  const linkValid = Number.isInteger(s.linkHours) && s.linkHours >= 6 && s.linkHours <= 168;
  const rt = s.routing;
  const routingValid = rt.autoMax <= rt.botMax && rt.botMax <= rt.agentMax;
  const setRouting = (next: Partial<Settings["routing"]>) => edit({ routing: { ...rt, ...next } });
  const threshold = (v: string) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

  return frame(
    <>
      <Card>
        <Switch label={t("enabled")} description={t("enabledHint")} checked={s.enabled} onChange={(e) => edit({ enabled: e.target.checked })} />
      </Card>


      <Card title={t("channels.title")}>
        <ul className="flex flex-wrap gap-2" data-testid="confirmation-channels">
          {(["whatsapp", "call_auto"] as const).map((c) => (
            <li key={c}><Badge tone={channels[c] ? "success" : "neutral"}>{t(`channel.${c}`)}{" · "}{t(channels[c] ? "channels.connected" : "channels.notConnected")}</Badge></li>
          ))}
          <li><Badge tone="success">{t("channel.call_team")}{" · "}{t("channels.always")}</Badge></li>
        </ul>
        {!channels.whatsapp ? <p className="mt-3 text-body-sm text-text-2">{t("channels.none")}</p> : null}
      </Card>

      <WhatsAppConnect templates={query.data.templates ?? []} choice={s.script?.template ?? null} onChoice={(template) => {
        const rest = { ...(s.script ?? DEFAULT_SCRIPT) };
        delete rest.template;
        edit({ script: template ? { ...rest, template } : rest });
      }} />

      <section className="mz-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center" data-testid="studio-card">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-sunk"><Icon name="scripts" size={20} /></span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-heading-sm">{t("studio.title")}</h2>
          <p className="text-body-sm text-text-2">{t("studio.body")}</p>
          <p className="flex flex-wrap items-center gap-1.5 text-caption text-text-3" data-testid="steps-summary" aria-label={t("studio.stepsLabel")}>
            {s.steps.map((st, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {i > 0 ? <Icon name="forward" size={12} /> : null}
                <span className="rounded-full bg-surface-sunk px-2 py-0.5 text-text-2">{t(`channel.${st.channel}`)}</span>
              </span>
            ))}
          </p>
        </div>
        <Link href="/settings/confirmation/studio" className={buttonClass("primary", "md", "shrink-0")}>
          <Icon name="scripts" size={16} />{t("studio.open")}
        </Link>
      </section>

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

      <Card title={t("link.title")}>
        <Field label={t("link.hours")} hint={t("link.hint")} type="number" ltr min={6} max={168} value={s.linkHours} style={{ inlineSize: "9rem" }}
          onChange={(e) => edit({ linkHours: Number(e.target.value) })} />
      </Card>

      <SaveBar dirty={draft !== null} busy={save.isPending} canSave={routingValid && linkValid} onSave={() => save.mutate(s)} onDiscard={() => setDraft(null)} />
    </>,
  );
}

const WA_REASONS = ["token_refused", "token_lacks_permission", "template_pending", "template_rejected", "template_missing"] as const;

/**
 * The store's WhatsApp number (E6-10): the ids and token from Meta, stored encrypted and checked in
 * the background (the token works, the confirmation template is approved). Owner and admin connect;
 * ops managers see the status and can ask for a new check.
 */
function WhatsAppConnect({ templates, choice, onChoice }: { templates: Template[]; choice: ArabicChoice | null; onChoice(next: ArabicChoice | null): void }) {
  const t = useTranslations("confirmationSettings.whatsapp");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const canConnect = can(store?.role, "whatsapp.connect");
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
  /** A failed load is not "no number connected": no connect form until we know. */
  const failed = list.isError && !list.data;
  const showForm = canConnect && (!wa || editing) && !failed;
  return (
    <Card title={t("title")} actions={wa ? <Badge tone={tone}>{t(`status.${wa.status}`)}</Badge> : null}>
      <div className="flex flex-col gap-3" data-testid="whatsapp-connect">
        <p className="text-body-sm text-text-2">{t("body")}</p>
        {list.isError && !list.data ? (
          <ErrorState compact error={list.error} onRetry={() => void list.refetch()} retrying={list.isRefetching} />
        ) : null}
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
        ) : failed ? null : <p className="text-body-sm text-text-3">{t("ownerOnly")}</p>}
        {wa ? <FirstMessage templates={templates} choice={choice} onChoice={onChoice} canSubmit={canConnect} /> : null}
      </div>
    </Card>
  );
}

const TEMPLATE_TONE: Record<Template["status"], "success" | "info" | "danger" | "warning" | "neutral"> = {
  APPROVED: "success", PENDING: "info", REJECTED: "danger", PAUSED: "warning", DISABLED: "warning", MISSING: "neutral", UNKNOWN: "neutral",
};

/**
 * E6-16d: the first message's templates in the store's WhatsApp account, each with Meta's review
 * state; the one orders get now is marked; owners and admins send one to Meta (MISSING or
 * REJECTED). The Arabic choice is saved with the settings (script.template).
 */
function FirstMessage({ templates, choice, onChoice, canSubmit }: { templates: Template[]; choice: ArabicChoice | null; onChoice(next: ArabicChoice | null): void; canSubmit: boolean }) {
  const t = useTranslations("confirmationSettings.whatsapp.templates");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["confirmationSettings"] }); };
  const submit = useMutation({
    mutationFn: (variant: Template["variant"]) => ok(api.POST("/v1/settings/confirmation/templates/{variant}/submit", { params: { path: { variant } } })),
    onSuccess: (r) => {
      toast({ message: t(r.queued ? "submitted" : "already") });
      refresh(); // the job runs in the background: the row shows it on its way, polled until Meta answers
    },
  });
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4" data-testid="whatsapp-templates" aria-labelledby="wa-templates-title">
      <h3 id="wa-templates-title" className="text-label">{t("title")}</h3>
      <p className="text-body-sm text-text-2">{t("body")}</p>
      <Select label={t("choice")} hint={t("choiceHint")} value={choice ?? ""} className="w-72"
        onChange={(e) => onChoice((AR_CHOICES as readonly string[]).includes(e.target.value) ? (e.target.value as ArabicChoice) : null)}>
        <option value="">{t("follow")}</option>
        {AR_CHOICES.map((v) => <option key={v} value={v}>{t(`variant.${v}`)}</option>)}
      </Select>
      <ul className="flex flex-col divide-y divide-line">
        {templates.map((x) => (
          <li key={x.variant} className="flex flex-wrap items-center gap-2 py-2.5" data-testid={`template-${x.variant}`}>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{t(`variant.${x.variant}`)}</span>
              <bdi dir="ltr" className="mz-num text-caption text-text-3">{x.name}</bdi>
            </span>
            {x.submitting ? <Badge tone="info">{t("submitting")}</Badge> : <Badge tone={TEMPLATE_TONE[x.status]}>{t(`status.${x.status}`)}</Badge>}
            {x.effective ? <Badge tone="ink">{t("inUse")}</Badge> : null}
            {x.submittable && canSubmit ? (
              <Button size="sm" variant="secondary" icon="send" busy={submit.isPending && submit.variables === x.variant} onClick={() => submit.mutate(x.variant)}>{t("submit")}</Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
