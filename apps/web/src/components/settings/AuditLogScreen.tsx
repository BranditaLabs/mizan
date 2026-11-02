"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Bdi } from "@/components/Bdi";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { DateText } from "@/components/ui/Values";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { SettingsTabs } from "./SettingsTabs";

const READERS = new Set(["owner", "admin"]);
/** Families of actions to filter by (prefixes the API understands). */
const FAMILIES = ["member.", "connection.", "customer.", "order.", "refund.", "payment.", "shipment.", "store.", "support.", "user."] as const;

/**
 * Settings → Audit log (A-8, on E1-9): who did what in the store, newest first, including what
 * Mizan staff did (marked as Mizan) and support access. Owners and admins.
 */
export function AuditLogScreen() {
  const t = useTranslations("auditLog");
  const { api, user, store } = useSession();
  const role = store?.role ?? "";
  const [family, setFamily] = useState("");
  const q = useInfiniteQuery({
    queryKey: ["auditLog", user?.uid ?? "", store?.tenantId ?? "", family],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => ok(api.GET("/v1/audit-log", { params: { query: { limit: 50, ...(family ? { action: family } : {}), ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: READERS.has(role),
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const who = (a: { type: string; displayName: string | null }) =>
    a.type === "mizan_staff" ? t("actor.mizan") : a.type === "user" ? (a.displayName ?? t("actor.someone")) : t.has(`actor.${a.type}`) ? t(`actor.${a.type}` as "actor.system") : a.type;

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="audit-log">
      <SettingsTabs />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg">{t("title")}</h1>
          <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
        </div>
        {READERS.has(role) ? (
          <Select label={t("filter")} value={family} onChange={(e) => setFamily(e.target.value)}>
            <option value="">{t("all")}</option>
            {FAMILIES.map((f) => <option key={f} value={f}>{t(`families.${f.slice(0, -1)}` as "families.member")}</option>)}
          </Select>
        ) : null}
      </header>
      {!READERS.has(role) ? <div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>
        : !q.data ? <div className="mz-card"><SkeletonRows rows={5} label={t("loading")} /></div>
        : !rows.length ? <div className="mz-card"><EmptyState icon="note" title={t("empty.title")} body={t("empty.body")} /></div>
        : (
          <div className="mz-table-wrap">
            <table className="mz-table">
              <thead><tr><th>{t("col.when")}</th><th>{t("col.who")}</th><th>{t("col.what")}</th><th>{t("col.on")}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><DateText value={r.createdAt} relative /></td>
                    <td>{r.actor.type === "mizan_staff" ? <Badge tone="ink">{who(r.actor)}</Badge> : who(r.actor)}</td>
                    <td>{t.has(`actions.${r.action}`) ? t(`actions.${r.action}` as "actions.member.invited") : <Bdi code>{r.action}</Bdi>}</td>
                    <td>{r.entity ? <Bdi code>{r.entity.type}</Bdi> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {q.hasNextPage ? <div><Button variant="secondary" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t("more")}</Button></div> : null}
    </div>
  );
}
