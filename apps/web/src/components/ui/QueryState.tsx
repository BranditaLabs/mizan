"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { MizanLoader } from "@mizan/design-system/react/motion";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api/client";
import { Button } from "./Button";
import { cx } from "./logic";
import { SkeletonRows } from "./Surface";

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
 * What a screen shows while it has no data yet (Brand 2.0 "pair": page or data loading), and a
 * first load that failed → ErrorState with "try again". Once there is data, a later failed refresh
 * keeps it on screen (the toast says so).
 *
 *   variant="list"  still skeleton rows with a 20 px pair in the head (tables and lists)
 *   variant="card"  a centred 48 px pair (a card's own data)
 *   variant="page"  a 96 px pair in the brand tone (claims the view's one red)
 * Children replace the variant's frame (a screen's own skeleton): `<PageState query={q}><SkeletonRows …/></PageState>`.
 */
export function PageState({ query, children, variant = "list", label, rows, compact = false, className }: {
  query?: Failed; children?: ReactNode; variant?: "list" | "card" | "page"; label?: string; rows?: number; compact?: boolean; className?: string;
}) {
  const t = useTranslations("motion.loader");
  if (query && query.isError && query.data === undefined) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} compact={compact} />;
  }
  if (children !== undefined) return <>{children}</>;
  const text = label ?? t("loading");
  if (variant === "list") return <SkeletonRows rows={rows} label={text} />;
  return (
    <div className={cx("grid place-items-center text-text", variant === "page" ? "min-h-[50dvh] py-10" : "py-6", className)} data-testid="page-state">
      <MizanLoader kind="pair" size={variant === "page" ? 96 : 48} tone={variant === "page" ? "brand" : "mono"} label={text} />
    </div>
  );
}

/** The old name (one release): `Pending` is PageState. */
export const Pending = PageState;
