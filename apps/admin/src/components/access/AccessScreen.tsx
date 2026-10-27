"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Bdi } from "@/components/Bdi";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { When } from "@/components/ui/When";
import { Link } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

/**
 * A-3: my open support access. Inside a store, the dashboard (apps/web) is where the work happens:
 * the store sees a banner while access is open and every start and end in its audit log.
 */
export function AccessScreen() {
  const t = useTranslations("access");
  const qc = useQueryClient();
  const { api } = useSession();
  const q = useQuery({ queryKey: ["my-access"], queryFn: () => ok(api.GET("/v1/platform/access")) });
  const end = useMutation({
    mutationFn: (storeId: string) => ok(api.POST("/v1/platform/stores/{storeId}/access/end", { params: { path: { storeId } } })),
    onSettled: () => qc.invalidateQueries({ queryKey: ["my-access"] }),
  });
  const grants = q.data?.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {q.data && !grants.length ? <p className="text-body-sm text-text-2">{t("none")}</p> : null}
      <ul className="flex flex-col gap-3" data-testid="my-access">
        {grants.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4">
            <div>
              <Link href={`/stores/${g.storeId}`} className="font-medium underline-offset-2 hover:underline">{g.storeName}</Link>
              <p className="text-body-sm text-text-2"><Bdi>{g.reason}</Bdi></p>
              <p className="text-caption text-text-2">{t.rich("until", { b: (c) => <Bdi>{c}</Bdi>, when: g.expiresAt.slice(11, 16) })} · <When value={g.expiresAt} time /></p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={g.mode === "write" ? "warning" : "info"}>{t(`mode.${g.mode}`)}</Badge>
              <Button variant="secondary" busy={end.isPending && end.variables === g.storeId} onClick={() => end.mutate(g.storeId)}>{t("end")}</Button>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-caption text-text-2">{t("howTo")}</p>
    </div>
  );
}
