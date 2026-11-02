"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Cell, DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { DateText } from "@/components/ui/Values";
import { ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { SettingsTabs } from "./SettingsTabs";

type Row = Schemas["PrivacyRequests"]["data"][number];
const READERS = new Set(["owner", "admin"]);
const SOURCES = new Set(["shopify_customers_data_request", "shopify_customers_redact", "shopify_shop_redact", "merchant", "customer"]);
const STATUSES = new Set(["received", "in_progress", "done", "rejected"]);
const TONE: Record<string, BadgeTone> = { received: "info", in_progress: "warning", done: "success", rejected: "neutral" };

/**
 * Settings → Privacy (Law 151/2020, PDPL; docs/07): the data requests the store received, when
 * each is due and whether it is done. A customer's data request can be downloaded as JSON to send
 * them; every download is in the audit log.
 */
export function PrivacyScreen() {
  const t = useTranslations("privacySettings");
  const tpr = useTranslations("problem");
  const { api, user, store } = useSession();
  const allowed = READERS.has(store?.role ?? "");
  const [now] = useState(() => Date.now());
  const q = useQuery({
    queryKey: ["privacyRequests", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/privacy-requests")),
    enabled: allowed,
  });
  const download = useMutation({
    mutationFn: async (id: string) => {
      const data = await ok(api.GET("/v1/privacy-requests/{id}/export", { params: { path: { id } } }));
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `mizan-data-request-${id.slice(0, 8)}.json` });
      a.click();
      URL.revokeObjectURL(url);
    },
    meta: { toast: false },
  });
  const columns: Column<Row>[] = [
    { id: "source", header: t("columns.source"), cell: (r) => <Cell main={SOURCES.has(r.source) ? t(`source.${r.source as "merchant"}`) : r.source} sub={<DateText value={r.createdAt} />} /> },
    { id: "status", header: t("columns.status"), cell: (r) => <Badge tone={TONE[r.status] ?? "neutral"}>{STATUSES.has(r.status) ? t(`status.${r.status as "done"}`) : r.status}</Badge> },
    { id: "due", header: t("columns.due"), cell: (r) => r.completedAt ? <Cell main={t("completed")} sub={<DateText value={r.completedAt} />} />
      : <span className={Date.parse(r.dueAt) < now ? "text-danger-text" : undefined}><DateText value={r.dueAt} relative now={now} /></span> },
    { id: "export", header: t("columns.export"), cell: (r) => r.hasExport
      ? <Button size="sm" variant="secondary" icon="download" busy={download.isPending && download.variables === r.id} onClick={() => download.mutate(r.id)}>{t("download")}</Button>
      : <span className="text-text-3">—</span> },
  ];
  const body = !allowed ? <div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>
    : q.isPending ? <div className="mz-card"><SkeletonRows rows={3} label={t("loading")} /></div>
    : q.isError ? <Alert tone="danger">{problemText(q.error, tpr)}</Alert>
    : <DataTable label={t("title")} columns={columns} rows={q.data.data} rowKey={(r) => r.id} rowLabel={(r) => r.id}
        empty={<EmptyState icon="customer" title={t("empty.title")} body={t("empty.body")} />} />;
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="privacy-settings">
      <SettingsTabs />
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {download.isError ? <Alert tone="danger">{problemText(download.error, tpr)}</Alert> : null}
      {body}
    </div>
  );
}
