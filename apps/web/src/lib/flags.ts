"use client";

import { useQuery } from "@tanstack/react-query";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

/**
 * A feature flag for the current store (A-6): off until Mizan staff turn it on for everyone or for
 * this store. Off while loading and on any error, so a new screen never flashes in by mistake.
 */
export function useFlag(key: string): boolean {
  const { api, user, store } = useSession();
  const q = useQuery({
    queryKey: ["flags", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/flags")),
    enabled: Boolean(store),
    staleTime: 5 * 60_000,
    meta: { toast: false },
  });
  return q.data?.flags[key] ?? false;
}
