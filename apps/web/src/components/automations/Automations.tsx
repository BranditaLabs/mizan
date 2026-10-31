"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Choice";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { DateText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";

type Automation = Schemas["AutomationList"]["data"][number];
type Recipe = Schemas["RecipeList"]["data"][number];
const MANAGERS = new Set(["owner", "admin", "ops_manager"]);
const KNOWN_TRIGGERS = new Set(["order.created", "order.scored", "order.duplicate_found", "order.store_cancel_failed", "order.assigned", "order.tagged", "order.confirmed", "order.cancelled",
  "stock.short", "stock.low", "stock.out", "connection.needs_attention", "offer.accepted", "payment.received", "ticket.created", "ticket.status_changed", "ticket.assigned"]);
const KNOWN_ACTIONS = new Set(["order.add_tag", "order.assign", "order.convert_to_prepaid", "notify.team"]);

/**
 * Automation Studio (M13, E11-2): the store's automations with an on/off switch and their run
 * log, and the built-in recipes to install (each an editable copy, off until turned on). The
 * When → If → Then builder comes later; today recipes are the way in.
 */
export function Automations() {
  const t = useTranslations("automations");
  const locale = useLocale() === "en" ? "en" : "ar";
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const allowed = MANAGERS.has(store?.role ?? "");
  const scope = [user?.uid ?? "", store?.tenantId ?? ""];
  const [log, setLog] = useState<Automation | null>(null);
  const [trying, setTrying] = useState<Automation | null>(null);
  const list = useQuery({ queryKey: ["automations", ...scope], queryFn: () => ok(api.GET("/v1/automations")), enabled: Boolean(store) && allowed });
  // The registry in code says which triggers carry an order: those can be tried on one (E11-3).
  const catalog = useQuery({ queryKey: ["automationCatalog", ...scope], queryFn: () => ok(api.GET("/v1/catalog")), enabled: Boolean(store) && allowed, staleTime: Infinity });
  const orderTriggers = new Set((catalog.data?.triggers ?? []).filter((c) => c.context === "order").map((c) => c.event));
  const recipes = useQuery({ queryKey: ["recipes", ...scope, locale], queryFn: () => ok(api.GET("/v1/automations/recipes", { params: { query: { lang: locale } } })), enabled: Boolean(store) && allowed });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["automations"] }); void qc.invalidateQueries({ queryKey: ["recipes"] }); };
  const install = useMutation({
    mutationFn: (key: string) => ok(api.POST("/v1/automations/recipes/{key}/install", { params: { path: { key } }, body: { language: locale } })),
    onSuccess: (a) => { toast({ message: t("installed", { name: a.name }) }); refresh(); },
  });
  const toggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => ok(api.PATCH("/v1/automations/{id}", { params: { path: { id: v.id } }, body: { enabled: v.enabled } })),
    onSuccess: (a) => { toast({ message: a.enabled ? t("on", { name: a.name }) : t("off", { name: a.name }) }); refresh(); },
  });

  const trigger = (e: string) => (KNOWN_TRIGGERS.has(e) ? t(`trigger.${e.replace(".", "_")}` as "trigger.order_created") : e);
  const action = (a: string) => (KNOWN_ACTIONS.has(a) ? t(`action.${a.replace(".", "_")}` as "action.order_add_tag") : a);

  const frame = (body: React.ReactNode) => (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 pt-6 pb-14 md:px-6" data-testid="automations">
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {body}
    </div>
  );
  if (!allowed) return frame(<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>);

  const mine = list.data?.data ?? [];
  return frame(
    <>
      <section className="flex flex-col gap-3" aria-labelledby="mine-title">
        <h2 id="mine-title" className="text-heading-sm">{t("mine")}</h2>
        {list.isPending ? <div className="mz-card"><SkeletonRows rows={3} label={t("loading")} /></div> : null}
        {list.data && mine.length === 0 ? <div className="mz-card"><EmptyState icon="automations" title={t("empty.title")} body={t("empty.body")} /></div> : null}
        <ul className="flex flex-col gap-3" data-testid="my-automations">
          {mine.map((a) => (
            <li key={a.id} className="mz-card flex flex-col gap-3 p-4">
              <Switch label={<span className="text-label">{a.name}</span>} description={t("when", { trigger: trigger(a.trigger) })}
                checked={a.enabled} disabled={toggle.isPending} onChange={(e) => toggle.mutate({ id: a.id, enabled: e.target.checked })} />
              {a.pausedReason === "errors" ? <Alert tone="danger">{t("paused")}</Alert> : null}
              <div className="flex flex-wrap items-center justify-between gap-2 text-body-sm text-text-2">
                <span>
                  {t("stats", { runs: a.stats.runs, failures: a.stats.failures })}
                  {a.stats.lastRunAt ? <>{" · "}{t("lastRun")}{" "}<DateText value={a.stats.lastRunAt} /></> : null}
                </span>
                <span className="flex gap-1">
                  {orderTriggers.has(a.trigger) ? <Button size="sm" variant="ghost" onClick={() => setTrying(a)}>{t("try.open")}</Button> : null}
                  <Button size="sm" variant="ghost" onClick={() => setLog(a)}>{t("runLog")}</Button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="recipes-title">
        <h2 id="recipes-title" className="text-heading-sm">{t("recipes")}</h2>
        <p className="text-body-sm text-text-2">{t("recipesHint")}</p>
        {recipes.isPending ? <div className="mz-card"><SkeletonRows rows={3} label={t("loading")} /></div> : null}
        <ul className="grid gap-3 md:grid-cols-2" data-testid="recipes">
          {(recipes.data?.data ?? []).map((r: Recipe) => (
            <li key={r.key} className="mz-card flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-label">{r.name}</h3>
                <Badge tone="neutral" dot={false}>{t(`domain.${r.domain}`)}</Badge>
              </div>
              <p className="text-body-sm text-text-2">{t("when", { trigger: trigger(r.trigger) })}</p>
              <ul className="flex flex-col gap-0.5 text-body-sm">
                {r.steps.map((s, i) => <li key={i}>{t("then", { action: action(s.action) })}</li>)}
              </ul>
              <div className="mt-auto pt-1">
                {r.installed
                  ? <Badge tone="success">{t("isInstalled")}</Badge>
                  : <Button size="sm" variant="secondary" icon="add" busy={install.isPending && install.variables === r.key} onClick={() => install.mutate(r.key)}>{t("install")}</Button>}
              </div>
            </li>
          ))}
        </ul>
      </section>
      {log ? <RunLog automation={log} onClose={() => setLog(null)} /> : null}
      {trying ? <TryIt automation={trying} action={action} onClose={() => setTrying(null)} /> : null}
    </>,
  );
}

/** The last 50 runs: ran, skipped (and why) or failed (and which step). */
function RunLog({ automation, onClose }: { automation: Automation; onClose(): void }) {
  const t = useTranslations("automations.log");
  const { api, user, store } = useSession();
  const q = useQuery({
    queryKey: ["automation", user?.uid ?? "", store?.tenantId ?? "", automation.id],
    queryFn: () => ok(api.GET("/v1/automations/{id}", { params: { path: { id: automation.id } } })),
  });
  const reason = (r: string | null) => (r === "conditions" || r === "loop_guard" || r === "invalid_conditions" ? t(`reason.${r}`) : r);
  return (
    <Dialog open onClose={onClose} title={t("title", { name: automation.name })} footer={<Button variant="ghost" onClick={onClose}>{t("close")}</Button>}>
      {q.isPending ? <SkeletonRows rows={4} label={t("loading")} /> : null}
      {q.data && q.data.runs.length === 0 ? <p className="text-body-sm text-text-2">{t("empty")}</p> : null}
      <ul className="flex flex-col divide-y divide-line text-body-sm" data-testid="run-log">
        {(q.data?.runs ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="flex flex-col">
              <span className="flex items-center gap-2">
                <Badge tone={r.status === "succeeded" ? "success" : r.status === "failed" ? "danger" : "neutral"}>{t(`status.${r.status}`)}</Badge>
                {r.entityId && r.event.startsWith("order.") ? <Link href={`/orders/${r.entityId}`} className="hover:underline">{t("order")}</Link> : null}
              </span>
              {r.reason ? <span className="text-caption text-text-3"><Bdi>{reason(r.reason)}</Bdi></span> : null}
            </span>
            <span className="text-caption text-text-3"><DateText value={r.at} /></span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v));

/**
 * Try an automation on one order (E11-3 dry run): each rule with the order's actual value, and the
 * steps that would run. Nothing is done, nothing is logged as a run.
 */
function TryIt({ automation, action, onClose }: { automation: Automation; action(a: string): string; onClose(): void }) {
  const t = useTranslations("automations.try");
  const tpr = useTranslations("problem");
  const { api } = useSession();
  const [number, setNumber] = useState("");
  const run = useMutation({
    mutationFn: async () => {
      const found = await ok(api.GET("/v1/orders", { params: { query: { q: number.trim(), limit: 1 } } }));
      const order = found.data[0];
      if (!order) return null;
      return { order: order.number, result: await ok(api.POST("/v1/automations/{id}/test", { params: { path: { id: automation.id } }, body: { orderId: order.id } })) };
    },
    meta: { toast: false },
  });
  const r = run.data?.result;
  return (
    <Dialog open onClose={onClose} title={t("title", { name: automation.name })} description={t("body")} footer={<Button variant="ghost" onClick={onClose}>{t("close")}</Button>}>
      <div className="flex flex-col gap-3">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (number.trim()) run.mutate(); }}>
        <Field label={t("order")} hint={t("orderHint")} ltr value={number} onChange={(e) => setNumber(e.target.value)} className="min-w-0 flex-1" />
        <Button type="submit" busy={run.isPending} disabled={!number.trim()}>{t("run")}</Button>
      </form>
      {run.isError ? <Alert tone="danger">{problemText(run.error, tpr)}</Alert> : null}
      {run.data === null ? <Alert tone="warning">{t("noOrder")}</Alert> : null}
      {r ? (
        <div className="flex flex-col gap-3" data-testid="dry-run">
          <p className="flex items-center gap-2 text-body-sm">
            <Badge tone={r.matched ? "success" : "neutral"}>{r.matched ? t("matched") : t("notMatched")}</Badge>
            <Bdi>{run.data?.order}</Bdi>
          </p>
          {r.rules.length ? (
            <ul className="flex flex-col divide-y divide-line text-body-sm">
              {r.rules.map((rule, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span><bdi dir="ltr" className="mz-id">{rule.field} {rule.op} {show(rule.value)}</bdi></span>
                  <span className="flex items-center gap-2">
                    <span className="text-caption text-text-2">{t("actual")} <bdi dir="ltr" className="mz-id">{show(rule.actual)}</bdi></span>
                    <Badge tone={rule.pass ? "success" : "danger"}>{rule.pass ? t("pass") : t("fail")}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="text-body-sm text-text-2">{t("noRules")}</p>}
          <div>
            <h3 className="text-label">{r.matched ? t("wouldRun") : t("wouldNotRun")}</h3>
            <ul className="mt-1 flex flex-col gap-1 text-body-sm">
              {r.steps.map((s, i) => (
                <li key={i}>
                  {action(s.action)}
                  {typeof s.params.message === "string" ? <span className="block text-caption text-text-2" dir="auto">{s.params.message}</span> : null}
                  {s.note ? <span className="block text-caption text-danger-text">{t("noOrderStep")}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      </div>
    </Dialog>
  );
}
