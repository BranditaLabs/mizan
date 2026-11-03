"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api/client";
import { Button } from "./Button";
import { cx } from "./logic";

type Failed = { isError: boolean; error: unknown; data?: unknown; isRefetching?: boolean; refetch(): unknown };

/**
 * What a screen shows when its data could not be loaded (U2). Before this, a failed first load
 * kept the skeleton forever or showed "nothing here yet". Says why in plain words (no connection,
 * not for your role, gone, or a server problem) and offers to try again where that can help.
 */
export function ErrorState({ error, onRetry, retrying = false, compact = false, className }: {
  error: unknown; onRetry?(): void; retrying?: boolean; compact?: boolean; className?: string;
}) {
  const t = useTranslations("problems");
  const status = error instanceof ApiError ? error.status : undefined;
  const kind = status === 0 ? "network" : status === 403 ? "forbidden" : status === 404 ? "notFound" : "server";
  const canRetry = Boolean(onRetry) && kind !== "forbidden" && kind !== "notFound";
  return (
    <div role="alert" className={cx(compact ? "flex flex-wrap items-center gap-3 p-4 text-body-sm" : "mz-empty", className)} data-testid="error-state">
      <Icon name={kind === "network" ? "offline" : kind === "forbidden" ? "locked" : "warning"} size={compact ? 18 : 24} />
      <div className={compact ? "flex min-w-0 flex-1 flex-col" : "contents"}>
        <h3 className="text-text">{t(`load.${kind}.title`)}</h3>
        <p className={cx("text-body-sm", compact ? "text-text-2" : "max-w-[48ch]")}>{t(`load.${kind}.body`)}</p>
      </div>
      {canRetry ? (
        <div className={compact ? "" : "mt-2"}>
          <Button size="sm" variant="secondary" icon="refresh" busy={retrying} onClick={() => onRetry?.()}>{t("retry")}</Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Loading → its skeleton; a first load that failed → ErrorState with "try again". Wraps what a
 * screen shows while it has no data yet: `{!q.data ? <Pending query={q}><SkeletonRows …/></Pending> : …}`.
 * Once there is data, a later failed refresh keeps it on screen (the toast says so).
 */
export function Pending({ query, children, compact = false }: { query: Failed; children: ReactNode; compact?: boolean }) {
  if (query.isError && query.data === undefined) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} compact={compact} />;
  }
  return <>{children}</>;
}
