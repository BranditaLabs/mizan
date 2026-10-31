"use client";

import { toAsciiDigits } from "@mizan/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Field, Select, TextArea } from "@/components/ui/Field";
import { StatCard } from "@/components/ui/StatCard";
import { Card, EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { DateText, MoneyText } from "@/components/ui/Values";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { SettingsTabs } from "./SettingsTabs";

type List = Schemas["AdSpendList"];
type Platform = Schemas["SetAdSpend"]["platform"];
const PLATFORMS: readonly Platform[] = ["meta", "tiktok", "google", "snapchat", "other"];
const EDITORS = new Set(["owner", "admin", "finance"]);
const READERS = new Set([...EDITORS, "ops_manager"]);
const AMOUNT = /^\d{1,12}(\.\d{1,3})?$/;
const decimal = (v: string) => toAsciiDigits(v).replace(/[٫,]/g, ".").trim();
/** A store day as a date the formatter shows without shifting it (noon UTC). */
const asDay = (day: string) => `${day}T12:00:00Z`;

/**
 * Settings → Ad spend (M5, E9-3): what the store spent on ads each day, typed in or imported
 * from a CSV, before the ad platforms connect (M7). Each day's spend is split over the orders the
 * store took that day, so every order's profit carries its ads; a day without orders is shown as
 * spend no order carries.
 */
export function AdSpendScreen() {
  const t = useTranslations("adSpend");
  const { api, user, store } = useSession();
  const role = store?.role ?? "";
  const canRead = READERS.has(role);
  const canEdit = EDITORS.has(role);
  const list = useQuery({
    queryKey: ["adSpend", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/ad-spend")),
    enabled: Boolean(store) && canRead,
  });

  const frame = (body: ReactNode) => (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6">
      <SettingsTabs />
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {body}
    </div>
  );
  if (!canRead) return frame(<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>);
  if (list.isPending) return frame(<div className="mz-card"><SkeletonRows rows={5} label={t("loading")} /></div>);
  if (list.isError) return frame(<Alert tone="danger">{t("loadFailed")}</Alert>);
  const l = list.data;

  return frame(
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="ad-summary">
        <StatCard label={t("summary.total")} value={<MoneyText money={l.total} />} period={t("summary.period")} />
        <StatCard label={t("summary.unallocated")} value={<MoneyText money={l.unallocated} />} period={t("summary.unallocatedHint")} />
        <StatCard label={t("summary.platforms")} value={l.byPlatform.length ? (
          <span className="flex flex-col text-body-sm">
            {l.byPlatform.map((p) => <span key={p.platform}>{t(`platform.${p.platform}`)}{" · "}<MoneyText money={p.spend} /></span>)}
          </span>
        ) : <MoneyText money={{ amount: "0.00", currency: l.baseCurrency }} />} />
      </div>
      {!canEdit ? <Alert tone="warning">{t("readOnly")}</Alert> : null}
      {canEdit ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <AddDay baseCurrency={l.baseCurrency} today={l.to} />
          <ImportCsv />
        </div>
      ) : null}
      <Days list={l} />
      <Entries list={l} canEdit={canEdit} />
    </>,
  );
}

/** Type a day's spend on one platform. */
function AddDay({ baseCurrency, today }: { baseCurrency: string; today: string }) {
  const t = useTranslations("adSpend.add");
  const tp = useTranslations("adSpend.platform");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ day: today, platform: "meta" as Platform, amount: "", currency: baseCurrency });
  const amount = decimal(form.amount);
  const valid = AMOUNT.test(amount) && Boolean(form.day) && form.day <= today && /^[A-Z]{3}$/.test(form.currency);
  const save = useMutation({
    mutationFn: () => ok(api.PUT("/v1/ad-spend", { body: { day: form.day, platform: form.platform, amount, currency: form.currency } })),
    onSuccess: () => { setForm({ ...form, amount: "" }); toast({ message: t("saved") }); void qc.invalidateQueries({ queryKey: ["adSpend"] }); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (valid) save.mutate(); };
  return (
    <Card title={t("title")}>
      <form className="flex flex-col gap-3" onSubmit={submit} data-testid="ad-add">
        <p className="text-body-sm text-text-2">{t("body")}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("day")} type="date" ltr max={today} value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} />
          <Select label={t("platform")} value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as Platform })}>
            {PLATFORMS.map((p) => <option key={p} value={p}>{tp(p)}</option>)}
          </Select>
          <Field label={t("amount")} ltr inputMode="decimal" value={form.amount} placeholder="2500"
            error={form.amount && !AMOUNT.test(amount) ? t("amountInvalid") : null} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <Field label={t("currency")} hint={t("currencyHint")} ltr maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
        </div>
        <div><Button type="submit" icon="success" disabled={!valid} busy={save.isPending}>{t("save")}</Button></div>
      </form>
    </Card>
  );
}

/** Import a platform's export or a sheet; every bad line is named and nothing is saved. */
function ImportCsv() {
  const t = useTranslations("adSpend.import");
  const tp = useTranslations("adSpend.platform");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [csv, setCsv] = useState("");
  const [platform, setPlatform] = useState<Platform | "">("");
  const run = useMutation({
    mutationFn: () => ok(api.POST("/v1/ad-spend/import", { body: { csv, ...(platform ? { platform } : {}) } })),
    meta: { toast: false },
    onSuccess: (r) => { setCsv(""); toast({ message: t("done", { rows: r.rows, days: r.days }) }); void qc.invalidateQueries({ queryKey: ["adSpend"] }); },
    onError: (e) => { if (!(e instanceof ApiError && e.code === "csv_invalid")) toast({ message: e instanceof ApiError && e.title ? e.title : t("failed") }); },
  });
  const lines = run.error instanceof ApiError && run.error.code === "csv_invalid" ? run.error.errors ?? [] : [];
  const readFile = async (file: File | undefined) => { if (file) setCsv(await file.text()); };
  return (
    <Card title={t("title")}>
      <div className="flex flex-col gap-3" data-testid="ad-import">
        <p className="text-body-sm text-text-2">{t("body")}</p>
        <label className="flex flex-col gap-1 text-body-sm">
          <span className="font-medium">{t("file")}</span>
          <input type="file" accept=".csv,text/csv" className="text-body-sm" onChange={(e) => void readFile(e.target.files?.[0])} />
        </label>
        <TextArea label={t("paste")} hint={t("pasteHint")} rows={4} dir="ltr" value={csv} onChange={(e) => setCsv(e.target.value)} />
        <Select label={t("platform")} value={platform} onChange={(e) => setPlatform(e.target.value as Platform | "")} className="max-w-xs">
          <option value="">{t("platformFromFile")}</option>
          {PLATFORMS.map((p) => <option key={p} value={p}>{tp(p)}</option>)}
        </Select>
        {lines.length ? (
          <Alert tone="danger" title={t("invalid", { count: lines.length })}>
            <ul className="mt-1 flex flex-col gap-0.5" data-testid="ad-import-errors">
              {lines.slice(0, 10).map((p) => (
                <li key={p.path}>
                  {t.rich("line", { line: p.path.replace("line:", ""), n: (c) => <Bdi>{c}</Bdi> })}{" · "}{t(`problem.${PROBLEMS.has(p.code) ? p.code : "other"}`)}
                  {p.message ? <>{" · "}<bdi dir="ltr">{p.message}</bdi></> : null}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <div><Button icon="upload" disabled={!csv.trim()} busy={run.isPending} onClick={() => run.mutate()}>{t("run")}</Button></div>
      </div>
    </Card>
  );
}
const PROBLEMS = new Set(["header", "columns", "day", "future", "too_old", "platform", "spend", "currency", "too_many", "empty"]);

/** Each day's spend, the orders that carry it and each one's share. */
function Days({ list }: { list: List }) {
  const t = useTranslations("adSpend.days");
  return (
    <Card title={t("title")}>
      <DataTable label={t("title")} rows={list.days} rowKey={(d) => `${d.connectionId}|${d.day}`}
        empty={<p className="py-6 text-center text-body-sm text-text-3">{t("empty")}</p>}
        defaultSort={{ id: "day", dir: "desc" }}
        columns={[
          { id: "day", header: t("day"), cell: (d) => <DateText value={asDay(d.day)} />, sortValue: (d) => d.day },
          { id: "spend", header: t("spend"), numeric: true, cell: (d) => <span className="inline-flex items-center gap-2"><MoneyText money={d.spend} />{d.fxMissing ? <Badge tone="warning">{t("fxMissing")}</Badge> : null}</span>, sortValue: (d) => Number(d.spend.amount) },
          { id: "orders", header: t("orders"), numeric: true, cell: (d) => <Bdi>{d.orders}</Bdi>, sortValue: (d) => d.orders },
          { id: "perOrder", header: t("perOrder"), numeric: true, cell: (d) => (d.perOrder ? <MoneyText money={d.perOrder} /> : <Badge tone="neutral">{t("unallocated")}</Badge>) },
        ]} />
    </Card>
  );
}

/** What was entered, per platform and campaign, with remove. */
function Entries({ list, canEdit }: { list: List; canEdit: boolean }) {
  const t = useTranslations("adSpend.entries");
  const tp = useTranslations("adSpend.platform");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: (r: { day: string; platform: Platform }) => ok(api.DELETE("/v1/ad-spend/{day}/{platform}", { params: { path: r } })),
    onSuccess: () => { toast({ message: t("removed") }); void qc.invalidateQueries({ queryKey: ["adSpend"] }); },
  });
  const rows = list.data;
  return (
    <Card title={t("title")}>
      <DataTable label={t("title")} rows={rows} rowKey={(r) => `${r.connectionId}|${r.day}|${r.platform}|${r.campaign ?? ""}|${r.spend.currency}`}
        empty={<p className="py-6 text-center text-body-sm text-text-3">{t("empty")}</p>}
        columns={[
          { id: "day", header: t("day"), cell: (r) => <DateText value={asDay(r.day)} />, sortValue: (r) => r.day },
          { id: "platform", header: t("platform"), cell: (r) => tp(r.platform) },
          { id: "campaign", header: t("campaign"), cell: (r) => r.campaign ?? <span className="text-text-3">{t("dayTotal")}</span> },
          { id: "spend", header: t("spend"), numeric: true, cell: (r) => <MoneyText money={r.spend} /> },
          { id: "source", header: t("source"), cell: (r) => <Badge tone="neutral">{t(`sources.${r.source}`)}</Badge> },
          ...(canEdit ? [{ id: "remove", header: t("actions"), cell: (r: List["data"][number]) => (
            <Button size="sm" variant="ghost" icon="delete" aria-label={t("removeLabel", { day: r.day, platform: tp(r.platform) })}
              busy={remove.isPending && remove.variables?.day === r.day && remove.variables.platform === r.platform}
              onClick={() => remove.mutate({ day: r.day, platform: r.platform })}>{t("remove")}</Button>
          ) }] : []),
        ]} />
    </Card>
  );
}
