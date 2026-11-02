"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Bdi } from "@/components/Bdi";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { When } from "@/components/ui/When";
import { Link } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

/** A-1: the staff trail, newest first: every back-office call, refusals included. */
export function AuditScreen() {
  const t = useTranslations("audit");
  const { api } = useSession();
  const q = useInfiniteQuery({
    queryKey: ["staff-trail"],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => ok(api.GET("/v1/platform/audit", { params: { query: { limit: 100, ...(pageParam ? { before: pageParam } : {}) } } })),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const lines = q.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      <div className="mz-table-wrap">
        <table className="mz-table" data-testid="trail">
          <thead><tr><th>{t("col.at")}</th><th>{t("col.who")}</th><th>{t("col.action")}</th><th>{t("col.outcome")}</th><th>{t("col.store")}</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td><When value={l.at} time /></td>
                <td><Bdi code>{l.email ?? "—"}</Bdi></td>
                <td><Bdi code>{l.action}</Bdi></td>
                <td><Badge tone={l.outcome === "ok" ? "success" : l.outcome === "denied" ? "danger" : "warning"}>{t(`outcome.${l.outcome}`)}</Badge>{l.status ? <> <Bdi>{l.status}</Bdi></> : null}</td>
                <td>{l.storeId ? <Link href={`/stores/${l.storeId}`} className="underline-offset-2 hover:underline">{t("open")}</Link> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {q.hasNextPage ? <div><Button variant="secondary" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t("more")}</Button></div> : null}
    </div>
  );
}
