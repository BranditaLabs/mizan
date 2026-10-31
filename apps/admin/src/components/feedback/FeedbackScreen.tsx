"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Choice";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { When } from "@/components/ui/When";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type Feedback = Schemas["PlatformFeedback"];
type Status = Feedback["status"];
const STATUSES: readonly Status[] = ["new", "seen", "done"];
const KIND_TONE: Record<Feedback["kind"], BadgeTone> = { idea: "info", problem: "danger", question: "warning" };
const PAGE = 50;

/** L1-8: what store members sent from the dashboard (idea, problem, question), newest first; staff move it from new to seen to done. */
export function FeedbackScreen() {
  const t = useTranslations("feedback");
  const qc = useQueryClient();
  const { api } = useSession();
  const [filter, setFilter] = useState<Status | "all">("new");
  const [offset, setOffset] = useState(0);
  const query = { ...(filter === "all" ? {} : { status: filter }), limit: PAGE, offset };
  const list = useQuery({ queryKey: ["feedback", query], queryFn: () => ok(api.GET("/v1/platform/feedback", { params: { query } })), placeholderData: keepPreviousData });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Status }) => ok(api.PATCH("/v1/platform/feedback/{id}", { params: { path: { id } }, body: { status } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["feedback"] }),
  });
  const rows = list.data?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<Status | "all"> label={t("filter")} value={filter} onChange={(v) => { setFilter(v); setOffset(0); }}
          options={[...STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })), { value: "all" as const, label: t("all") }]} />
        {list.data ? <p className="text-caption text-text-2" role="status">{t.rich("total", { n: list.data.total, b: (c) => <Bdi>{c}</Bdi> })}</p> : null}
      </div>
      {list.isPending ? <SkeletonRows rows={4} label={t("loading")} />
        : list.isError && !list.data ? <Alert tone="danger">{t("loadFailed")}</Alert>
        : rows.length === 0 ? <EmptyState icon="inbox" title={t("empty.title")} body={t("empty.body")} />
        : (
          <div className="mz-table-wrap">
            <table className="mz-table" data-testid="feedback-table">
              <thead><tr><th>{t("col.kind")}</th><th>{t("col.message")}</th><th>{t("col.store")}</th><th>{t("col.person")}</th><th>{t("col.page")}</th><th>{t("col.time")}</th><th>{t("col.status")}</th></tr></thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <td><Badge tone={KIND_TONE[f.kind]}>{t(`kind.${f.kind}`)}</Badge></td>
                    {/* The sender's own words, in the language they wrote in. */}
                    <td className="min-w-[28ch] max-w-[60ch] whitespace-pre-wrap break-words" lang={f.locale} dir="auto">{f.message}</td>
                    <td><Link href={`/stores/${f.store.id}`} className="underline-offset-2 hover:underline">{f.store.name}</Link></td>
                    <td>{f.person ? <Bdi>{f.person.name ?? f.person.email ?? t("noName")}</Bdi> : <span className="text-text-3">{t("gone")}</span>}</td>
                    <td><bdi dir="ltr" className="mz-num text-caption">{f.page}</bdi></td>
                    <td className="whitespace-nowrap"><When value={f.createdAt} time /></td>
                    <td>
                      <div className="flex items-center gap-2">
                        {f.status === "new" ? <span className="size-2 shrink-0 rounded-full bg-text" aria-hidden="true" /> : null}
                        <select aria-label={t("change")} className="mz-select w-auto min-w-24" value={f.status} disabled={update.isPending && update.variables?.id === f.id}
                          data-testid={`feedback-status-${f.id}`} onChange={(e) => update.mutate({ id: f.id, status: e.target.value as Status })}>
                          {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <div className="flex gap-2">
        {offset > 0 ? <Button variant="secondary" onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t("newer")}</Button> : null}
        {list.data?.nextOffset != null ? <Button variant="secondary" onClick={() => setOffset(list.data!.nextOffset!)}>{t("older")}</Button> : null}
      </div>
    </div>
  );
}
