"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Bdi } from "@/components/Bdi";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Surface";
import { When } from "@/components/ui/When";
import { Link } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const secs = (s: number) => (s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`);
const mb = (b: number | null) => (b == null ? "—" : `${Math.round(b / 1_048_576)} MB`);

/** A-4: the numbers /metrics reports, stores in trouble first, dead letters to replay, drift. */
export function HealthScreen() {
  const t = useTranslations("health");
  const qc = useQueryClient();
  const { api } = useSession();
  const h = useQuery({ queryKey: ["health"], queryFn: () => ok(api.GET("/v1/platform/health")), refetchInterval: 30_000 });
  const dead = useQuery({ queryKey: ["dead-letters"], queryFn: () => ok(api.GET("/v1/platform/health/dead-letters", { params: { query: { limit: 50 } } })) });
  const replay = useMutation({
    mutationFn: (id: string) => ok(api.POST("/v1/platform/health/dead-letters/{id}/replay", { params: { path: { id } } })),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ["dead-letters"] }); void qc.invalidateQueries({ queryKey: ["health"] }); },
  });
  const d = h.data;
  const tile = (label: string, value: string | number, bad = false) => (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-caption text-text-2">{label}</p>
      <p className={`mt-1 font-display text-heading-md ${bad ? "text-danger-text" : ""}`}><Bdi>{value}</Bdi></p>
    </div>
  );
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {d ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="health-tiles">
            {tile(t("jobsPending"), d.outbox.pending)}
            {tile(t("jobsDead"), d.outbox.dead, d.outbox.dead > 0)}
            {tile(t("jobsLag"), secs(d.outbox.oldestDueSeconds), d.outbox.oldestDueSeconds > 300)}
            {tile(t("eventsPending"), d.events.pending)}
            {tile(t("eventsDead"), d.events.dead, d.events.dead > 0)}
            {tile(t("eventsLag"), secs(d.events.oldestPendingSeconds), d.events.oldestPendingSeconds > 300)}
            {tile(t("dbSize"), mb(d.db.sizeBytes))}
            {tile(t("pool"), d.db.pool ? `${d.db.pool.total - d.db.pool.idle}/${d.db.pool.total}` : "—", (d.db.pool?.waiting ?? 0) > 0)}
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title={t("circuits")}>
              <ul className="flex flex-col gap-2 text-body-sm">
                {d.circuits.map((c) => (
                  <li key={c.provider} className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.provider}</span>
                    <span className="flex gap-2">
                      <Badge tone={c.open ? "danger" : "success"}>{t("open", { n: c.open })}</Badge>
                      {c.halfOpen ? <Badge tone="warning">{t("halfOpen", { n: c.halfOpen })}</Badge> : null}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-caption text-text-2">{t("perInstance")}</p>
            </Card>
            <Card title={t("storesInTrouble")}>
              {d.stores.length ? (
                <ul className="flex flex-col gap-1 text-body-sm">
                  {d.stores.map((s) => (
                    <li key={s.storeId} className="flex justify-between gap-2">
                      <Link href={`/stores/${s.storeId}`} className="underline-offset-2 hover:underline">{s.storeName}</Link>
                      <span>{t("storeLine", { pending: s.pending, dead: s.dead })}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-body-sm text-text-2">{t("allClear")}</p>}
            </Card>
          </div>
          <Card title={t("drift")}>
            {d.drift.length ? (
              <div className="mz-table-wrap">
                <table className="mz-table">
                  <thead><tr><th>{t("driftCol.where")}</th><th>{t("driftCol.kind")}</th><th>{t("driftCol.detail")}</th><th>{t("driftCol.count")}</th><th>{t("driftCol.last")}</th></tr></thead>
                  <tbody>
                    {d.drift.map((x, i) => (
                      <tr key={i}><td><Bdi code>{[x.connector, x.entity, x.field].filter(Boolean).join(" / ")}</Bdi></td><td>{x.kind}</td><td className="max-w-md truncate"><Bdi>{x.detail}</Bdi></td><td><Bdi>{x.count}</Bdi></td><td><When value={x.lastAt} time /></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-body-sm text-text-2">{t("noDrift")}</p>}
          </Card>
        </>
      ) : <p role="status" className="text-body-sm text-text-2">{t("loading")}</p>}
      <Card title={t("deadLetters")}>
        {dead.data?.data.length ? (
          <div className="mz-table-wrap">
            <table className="mz-table" data-testid="dead-letters">
              <thead><tr><th>{t("deadCol.store")}</th><th>{t("deadCol.kind")}</th><th>{t("deadCol.attempts")}</th><th>{t("deadCol.error")}</th><th>{t("deadCol.at")}</th><th /></tr></thead>
              <tbody>
                {dead.data.data.map((j) => (
                  <tr key={j.id}>
                    <td><Link href={`/stores/${j.storeId}`} className="underline-offset-2 hover:underline">{j.storeName}</Link></td>
                    <td><Bdi code>{j.kind}</Bdi></td><td><Bdi>{j.attempts}</Bdi></td>
                    <td className="max-w-xs truncate"><Bdi>{j.error ?? "—"}</Bdi></td><td><When value={j.failedAt} time /></td>
                    <td><Button size="sm" variant="secondary" busy={replay.isPending && replay.variables === j.id} onClick={() => replay.mutate(j.id)}>{t("replay")}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-body-sm text-text-2">{t("noDead")}</p>}
      </Card>
    </div>
  );
}
