"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const ENDERS = new Set(["owner", "admin"]);

/**
 * Mizan support in the store (A-3): while a support grant is open, one line across the dashboard
 * for everyone in the store — read-only or able to change things, why, and until when. Owners and
 * admins can end it at once. It cannot be hidden.
 */
export function SupportBanner() {
  const t = useTranslations("supportBanner");
  const format = useFormatter();
  const qc = useQueryClient();
  const { api, user, store } = useSession();
  const key = ["support-access", user?.uid ?? "", store?.tenantId ?? ""];
  const q = useQuery({
    queryKey: key,
    queryFn: () => ok(api.GET("/v1/support-access")),
    enabled: Boolean(store),
    refetchInterval: 60_000,
    meta: { toast: false },
  });
  const end = useMutation({
    mutationFn: (id: string) => ok(api.POST("/v1/support-access/{id}/end", { params: { path: { id } } })),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  // The API lists open grants only; refetching each minute drops one soon after it expires.
  const open = q.data?.data ?? [];
  if (!store || !open.length) return null;
  return (
    <div role="status" data-testid="support-banner" className="border-b border-info bg-info-soft px-4 py-2 text-body-sm text-info-text md:px-6">
      {open.map((g) => (
        <p key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            {t.rich(g.mode, {
              until: format.dateTime(new Date(g.expiresAt), { timeStyle: "short" }),
              reason: g.reason,
              n: (c) => <bdi dir="ltr" className="mz-num font-medium">{c}</bdi>,
              r: (c) => <bdi className="font-medium">{c}</bdi>,
            })}
          </span>
          {ENDERS.has(store.role) && (
            <button type="button" className="ms-auto font-medium underline disabled:opacity-60" disabled={end.isPending} onClick={() => end.mutate(g.id)}>{t("end")}</button>
          )}
        </p>
      ))}
    </div>
  );
}
