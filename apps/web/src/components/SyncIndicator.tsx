"use client";

import { can } from "@mizan/shared";
import { EventGlyph } from "@mizan/design-system/react/motion";
import { Waiting } from "@/components/ui/Loader";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useSurface } from "@/lib/motion/EventMotionProvider";
import { usePollMotion } from "@/lib/motion/usePollMotion";
import { useSession } from "@/lib/session";

type StoreImport = Schemas["StoreImports"]["data"][number];
/** A finished import stays in the frame this long, then the indicator steps aside. */
const SHOW_DONE_MS = 10 * 60_000;

/**
 * Each connected store's latest history import (A3), refreshed every 4 s while one runs. Owners,
 * admins and ops managers (the API refuses the others: then there is nothing to show).
 */
export function useStoreImports() {
  const { api, user, store } = useSession();
  const allowed = can(store?.role, "connections.read");
  return useQuery({
    queryKey: ["store-imports", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/connections/imports")),
    enabled: Boolean(store) && allowed,
    refetchInterval: (q) => (q.state.data?.data.some((s) => s.import?.status === "running") ? 4000 : false),
    meta: { toast: false },
  });
}

/** What the frame says about one store: importing, failed or needs attention, or just finished. */
function stateOf(s: StoreImport, now: number): "running" | "failed" | "attention" | "done" | null {
  if (s.connection === "needs_attention") return "attention";
  if (s.import?.status === "running") return "running";
  if (s.import?.status === "failed") return "failed";
  if (s.import?.status === "done" && s.import.finishedAt && now - Date.parse(s.import.finishedAt) < SHOW_DONE_MS) return "done";
  return null;
}

/**
 * The app frame's sync indicator (A3): while a store imports its history the team works in Mizan
 * and sees it come in ("Importing · 340 orders"); a failure or a store that refused Mizan shows in
 * red until it's fixed; a finished import says so for a few minutes. Opens setup, where Retry is.
 *
 * Brand 2.0 SyncPill: running with counts → fill (the count rises; no total yet, so it loops),
 * running without counts → transfer (two systems reconciling); done → merge; failed or needs
 * attention → fail, resting in the danger tone. A transition seen between two polls plays the
 * catalogue outcome once (connection.sync_completed, sync_failed, needs_attention).
 */
export function SyncIndicator() {
  const t = useTranslations("sync");
  const { store } = useSession();
  const q = useStoreImports();
  const now = q.dataUpdatedAt; // when the data was read (refetched on focus), so "just finished" fades without a clock in render
  usePollMotion(q.data?.data, (s) => s.connectionId, (s) => stateOf(s, now) ?? "idle", (from, to) => {
    if (from === undefined) return null;
    return to === "done" ? "connection.sync_completed" : to === "failed" ? "connection.sync_failed" : to === "attention" ? "connection.needs_attention" : null;
  });
  const played = useSurface("sync");
  const shown = (q.data?.data ?? []).map((s) => ({ s, state: stateOf(s, now) })).filter((x) => x.state);
  if (!shown.length) return null;
  // The most urgent first: a problem, then a running import, then a finished one.
  const rank = { attention: 0, failed: 1, running: 2, done: 3 } as const;
  const { s, state } = shown.sort((a, b) => rank[a.state!] - rank[b.state!])[0]!;
  const tone = state === "running" ? "text-info-text" : state === "done" ? "text-success-text" : "text-danger-text";
  const label = state === "running" ? t("running", { orders: s.import?.orders ?? 0, products: s.import?.products ?? 0 })
    : state === "done" ? t("done", { orders: s.import?.orders ?? 0 })
    : state === "failed" ? t("failed") : t("attention");
  const href = store?.role === "ops_manager" ? "/settings/integrations" : "/onboarding";
  return (
    <Link href={href} role="status" aria-live="polite" data-testid="sync-indicator"
      className={`hidden items-center gap-2 rounded-full border border-line px-3 py-1 text-caption hover:bg-surface-hover sm:inline-flex ${tone}`}>
      {state === "running"
        // An import has counts but no total yet: TRANSFER (two systems syncing), never an indeterminate FILL.
        ? <Waiting meaning="syncing" size={28} />
        : <EventGlyph key={played?.ids.join() ?? "rest"} outcome={state === "done" ? "merge" : "fail"} size={14} static={!played || played.entityId !== s.connectionId} />}
      <span className="max-w-[28ch] truncate">{label}</span>
      {shown.length > 1 ? <span className="text-text-3"><bdi>+{shown.length - 1}</bdi></span> : null}
    </Link>
  );
}
