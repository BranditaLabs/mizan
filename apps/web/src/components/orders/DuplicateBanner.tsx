"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, ButtonGroup } from "@/components/ui/Button";
import { IdCell } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type Order = Schemas["OrderDetail"];
const DECIDERS = new Set(["owner", "admin", "ops_manager", "agent"]);

/**
 * A likely duplicate (M1, E5-3): which earlier order it repeats and what matched; the team keeps
 * both (confirmation starts) or merges this one into the earlier (cancelled here, tagged in the
 * store). Kept and merged orders say so.
 */
export function DuplicateBanner({ order }: { order: Order }) {
  const t = useTranslations("orders.duplicate");
  const locale = useLocale();
  const { api, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const of = order.duplicateOf!;
  const resolve = useMutation({
    mutationFn: (action: "keep" | "merge") => ok(api.POST("/v1/orders/{id}/duplicate", { params: { path: { id: order.id } }, body: { action } })),
    onSuccess: (r) => {
      setConfirm(false);
      toast({ message: t(r.status === "merged" ? "merged" : "kept") });
      void qc.invalidateQueries({ queryKey: ["order"] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
  const link = <Link href={`/orders/${of.id}`} className="font-medium underline"><IdCell>{of.number}</IdCell></Link>;
  if (order.duplicate !== "suspected") {
    return <Alert tone="info">{t.rich(order.duplicate === "merged" ? "wasMerged" : "wasKept", { order: () => link })}</Alert>;
  }
  return (
    <div data-testid="duplicate-banner">
      <Alert tone="warning" title={t("title")}>
        <p>{t.rich("body", { order: () => link, minutes: of.minutesApart, items: new Intl.ListFormat(locale, { type: "conjunction" }).format(of.items) })}</p>
        {DECIDERS.has(store?.role ?? "") ? (
          <ButtonGroup className="mt-3">
            <Button size="sm" variant="secondary" busy={resolve.isPending && resolve.variables === "keep"} onClick={() => resolve.mutate("keep")}>{t("keep")}</Button>
            <Button size="sm" variant="danger" onClick={() => setConfirm(true)}>{t("merge")}</Button>
          </ButtonGroup>
        ) : null}
      </Alert>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => resolve.mutate("merge")} busy={resolve.isPending && resolve.variables === "merge"}
        title={t("mergeTitle")} description={t.rich("mergeBody", { order: () => <IdCell>{of.number}</IdCell> })} confirmLabel={t("merge")} />
    </div>
  );
}
