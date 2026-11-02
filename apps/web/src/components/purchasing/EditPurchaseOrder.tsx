"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { ok } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { NewPurchaseOrder } from "./NewPurchaseOrder";
import { MANAGERS } from "./purchasing-ui";

/** Edit a draft purchase order (M16-4a): the new-PO form, filled; only a draft can change. */
export function EditPurchaseOrder({ id }: { id: string }) {
  const t = useTranslations("purchasing");
  const tpr = useTranslations("problem");
  const { api, user, store } = useSession();
  const q = useQuery({
    queryKey: ["purchaseOrder", user?.uid ?? "", store?.tenantId ?? "", id],
    queryFn: () => ok(api.GET("/v1/purchase-orders/{id}", { params: { path: { id } } })),
    enabled: Boolean(store) && MANAGERS.has(store?.role ?? ""),
    meta: { toast: false },
  });
  const frame = (body: React.ReactNode) => <div className="mx-auto max-w-[1100px] px-4 pt-6 md:px-6"><div className="mz-card">{body}</div></div>;
  if (!MANAGERS.has(store?.role ?? "")) return <NewPurchaseOrder />;
  if (q.isPending) return frame(<SkeletonRows rows={4} label={t("loading")} />);
  if (!q.data) return frame(<EmptyState icon="error" title={problemText(q.error, tpr)} body="" />);
  if (q.data.status !== "draft") return frame(<EmptyState icon="locked" title={t("edit.notDraft.title")} body={t("edit.notDraft.body")} />);
  return <NewPurchaseOrder key={q.data.id} po={q.data} />;
}
