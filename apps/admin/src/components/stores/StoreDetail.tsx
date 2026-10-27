"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Select, TextArea } from "@/components/ui/Field";
import { Card, KeyValue } from "@/components/ui/Surface";
import { When } from "@/components/ui/When";
import { Link } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { StoreStatus } from "./StoreStatus";

const PLANS = ["free", "growth", "scale", "enterprise"] as const;
type Plan = (typeof PLANS)[number];

/**
 * A-2 store detail: the store's team, integrations and their health, its jobs and dead letters,
 * usage and internal notes; suspend / reactivate (super admin), change plan (super admin, finance),
 * open support access (A-3). Every change shows in the store's own audit log.
 */
export function StoreDetail({ storeId }: { storeId: string }) {
  const t = useTranslations("store");
  const tp = useTranslations("stores.plans");
  const qc = useQueryClient();
  const { api, can } = useSession();
  const key = ["store", storeId];
  const q = useQuery({ queryKey: key, queryFn: () => ok(api.GET("/v1/platform/stores/{storeId}", { params: { path: { storeId } } })) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ["stores"] }); };

  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState<Plan | "">("");
  const [note, setNote] = useState("");
  const [access, setAccess] = useState({ reason: "", minutes: "60", mode: "read" as "read" | "write" });

  const suspend = useMutation({ mutationFn: () => ok(api.POST("/v1/platform/stores/{storeId}/suspend", { params: { path: { storeId } }, body: { reason: reason.trim() } })), onSuccess: () => { setReason(""); refresh(); } });
  const reactivate = useMutation({ mutationFn: () => ok(api.POST("/v1/platform/stores/{storeId}/reactivate", { params: { path: { storeId } }, body: reason.trim() ? { reason: reason.trim() } : {} })), onSuccess: () => { setReason(""); refresh(); } });
  const changePlan = useMutation({ mutationFn: (p: Plan) => ok(api.PUT("/v1/platform/stores/{storeId}/plan", { params: { path: { storeId } }, body: { plan: p, ...(reason.trim() ? { reason: reason.trim() } : {}) } })), onSuccess: () => { setPlan(""); setReason(""); refresh(); } });
  const addNote = useMutation({ mutationFn: () => ok(api.POST("/v1/platform/stores/{storeId}/notes", { params: { path: { storeId } }, body: { body: note.trim() } })), onSuccess: () => { setNote(""); refresh(); } });
  const openAccess = useMutation({
    mutationFn: () => ok(api.POST("/v1/platform/stores/{storeId}/access", { params: { path: { storeId } }, body: { reason: access.reason.trim(), minutes: Number(access.minutes), mode: access.mode } })),
    onSuccess: () => { setAccess({ reason: "", minutes: "60", mode: "read" }); void qc.invalidateQueries({ queryKey: ["my-access"] }); },
  });

  if (q.isError) return <Alert tone="danger">{t("loadFailed")}</Alert>;
  if (!q.data) return <p role="status" className="text-body-sm text-text-2">{t("loading")}</p>;
  const s = q.data;
  const onNote = (e: FormEvent) => { e.preventDefault(); if (note.trim()) addNote.mutate(); };
  const onAccess = (e: FormEvent) => { e.preventDefault(); if (access.reason.trim().length >= 3) openAccess.mutate(); };

  return (
    <div className="flex flex-col gap-5" data-testid="store-detail">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/stores" className="text-body-sm text-text-2 underline-offset-2 hover:underline">{t("back")}</Link>
          <h1 className="mt-1 font-display text-heading-lg">{s.name}</h1>
          <p className="text-body-sm text-text-2"><Bdi code>{s.slug}</Bdi> · <Bdi code>{s.id}</Bdi></p>
        </div>
        <StoreStatus status={s.status} />
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title={t("summary")} className="lg:col-span-1">
          <KeyValue items={[
            { label: t("plan"), value: tp(s.plan) },
            { label: t("country"), value: <Bdi>{s.country}</Bdi> },
            { label: t("currency"), value: <Bdi>{s.currency}</Bdi> },
            { label: t("timezone"), value: <Bdi code>{s.timezone}</Bdi> },
            { label: t("created"), value: <When value={s.createdAt} /> },
            { label: t("members"), value: <Bdi>{s.members}</Bdi> },
          ]} />
        </Card>

        <Card title={t("actions")} className="lg:col-span-2">
          <div className="flex flex-col gap-4">
            {can("super_admin", "finance") ? (
              <Field label={t("reason")} hint={t("reasonHint")} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} name="reason" />
            ) : null}
            <div className="flex flex-wrap items-end gap-2">
              {can("super_admin") && s.status !== "suspended" && s.status !== "deleted" ? (
                <Button variant="danger" busy={suspend.isPending} disabled={reason.trim().length < 3} onClick={() => suspend.mutate()}>{t("suspend")}</Button>
              ) : null}
              {can("super_admin") && s.status === "suspended" ? (
                <Button busy={reactivate.isPending} onClick={() => reactivate.mutate()}>{t("reactivate")}</Button>
              ) : null}
              {can("super_admin", "finance") && s.status !== "deleted" ? (
                <>
                  <Select label={t("changePlan")} value={plan} onChange={(e) => setPlan(e.target.value as Plan)}>
                    <option value="">{t("choosePlan")}</option>
                    {PLANS.filter((p) => p !== s.plan).map((p) => <option key={p} value={p}>{tp(p)}</option>)}
                  </Select>
                  <Button variant="secondary" disabled={!plan} busy={changePlan.isPending} onClick={() => plan && changePlan.mutate(plan)}>{t("applyPlan")}</Button>
                </>
              ) : null}
            </div>
            <p className="text-caption text-text-2">{t("visibleToStore")}</p>
          </div>
        </Card>
      </div>

      {can("super_admin", "support", "engineer") ? (
        <Card title={t("access.title")}>
          <form onSubmit={onAccess} className="grid gap-3 md:grid-cols-4" noValidate>
            <Field label={t("access.reason")} className="md:col-span-2" value={access.reason} maxLength={500} name="accessReason" onChange={(e) => setAccess({ ...access, reason: e.target.value })} />
            <Select label={t("access.duration")} value={access.minutes} onChange={(e) => setAccess({ ...access, minutes: e.target.value })}>
              {["15", "30", "60", "120", "240", "480"].map((m) => <option key={m} value={m}>{t("access.minutes", { n: Number(m) })}</option>)}
            </Select>
            <Select label={t("access.mode")} value={access.mode} onChange={(e) => setAccess({ ...access, mode: e.target.value as "read" })}>
              <option value="read">{t("access.read")}</option>
              {can("super_admin") ? <option value="write">{t("access.write")}</option> : null}
            </Select>
            <div className="md:col-span-4 flex flex-wrap items-center gap-3">
              <Button type="submit" variant="secondary" busy={openAccess.isPending} disabled={access.reason.trim().length < 3}>{t("access.open")}</Button>
              <p className="text-caption text-text-2">{t("access.hint")}</p>
            </div>
            {openAccess.data ? <Alert tone="success">{t.rich("access.opened", { until: openAccess.data.expiresAt.slice(11, 16), b: (c) => <Bdi>{c}</Bdi> })}</Alert> : null}
          </form>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t("team")}>
          <ul className="flex flex-col divide-y divide-line">
            {s.team.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><span className="font-medium">{m.name ?? "—"}</span> <Bdi code>{m.email ?? ""}</Bdi></span>
                <span className="flex gap-2"><Badge>{m.role}</Badge>{m.status !== "active" ? <Badge tone="warning">{m.status}</Badge> : null}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t("integrations")}>
          {s.integrations.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {s.integrations.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><span className="font-medium">{c.provider}</span> <Bdi code>{c.account ?? ""}</Bdi></span>
                  <Badge tone={c.status === "active" ? "success" : c.status === "needs_attention" ? "danger" : "neutral"}>{c.reason ? t("integrationStatus", { status: c.status, reason: c.reason }) : c.status}</Badge>
                </li>
              ))}
            </ul>
          ) : <p className="text-body-sm text-text-2">{t("noIntegrations")}</p>}
        </Card>
      </div>

      <Card title={t("jobs")}>
        <p className="text-body-sm" data-testid="store-outbox">{t.rich("outbox", { pending: s.outbox.pending, running: s.outbox.running, dead: s.outbox.dead, b: (c) => <Bdi>{c}</Bdi> })}</p>
        {s.deadLetters.length ? (
          <div className="mz-table-wrap mt-3">
            <table className="mz-table">
              <thead><tr><th>{t("dead.kind")}</th><th>{t("dead.attempts")}</th><th>{t("dead.error")}</th><th>{t("dead.at")}</th></tr></thead>
              <tbody>
                {s.deadLetters.map((d) => (
                  <tr key={d.id}><td><Bdi code>{d.kind}</Bdi></td><td><Bdi>{d.attempts}</Bdi></td><td className="max-w-md truncate"><Bdi>{d.error ?? "—"}</Bdi></td><td><When value={d.failedAt} time /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t("usage")}>
          {s.usage.length ? (
            <ul className="flex flex-col gap-1 text-body-sm">
              {s.usage.map((u) => <li key={u.month} className="flex justify-between gap-2"><Bdi>{u.month.slice(0, 7)}</Bdi><span>{t("usageLine", { orders: u.orders, messages: u.whatsappMessages })}</span></li>)}
            </ul>
          ) : <p className="text-body-sm text-text-2">{t("noUsage")}</p>}
        </Card>
        <Card title={t("notes")}>
          <form onSubmit={onNote} className="flex flex-col gap-2">
            <TextArea label={t("addNote")} value={note} maxLength={2000} rows={3} name="note" onChange={(e) => setNote(e.target.value)} />
            <div><Button type="submit" variant="secondary" busy={addNote.isPending} disabled={!note.trim()}>{t("saveNote")}</Button></div>
          </form>
          <ul className="mt-3 flex flex-col gap-3" data-testid="store-notes">
            {s.notes.map((n) => (
              <li key={n.id} className="border-s-2 border-line ps-3">
                <p className="whitespace-pre-wrap text-body-sm">{n.body}</p>
                <p className="text-caption text-text-2"><Bdi code>{n.by ?? ""}</Bdi> · <When value={n.at} time /></p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-caption text-text-2">{t("notesHint")}</p>
        </Card>
      </div>
    </div>
  );
}
