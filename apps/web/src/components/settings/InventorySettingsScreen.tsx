"use client";

import { rolesWith } from "@mizan/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/Choice";
import { ErrorState } from "@/components/ui/QueryState";
import { EmptyState } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const MANAGERS = rolesWith("inventory.settings");

/** Settings → Inventory (U4): whether Mizan sends its count to the store. */
export function InventorySettingsScreen() {
  const t = useTranslations("settings");
  const { store } = useSession();
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="inventory-settings">
      <header>
        <h1 className="font-display text-heading-lg">{t("pages.inventory")}</h1>
        <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("about.inventory")}</p>
      </header>
      {MANAGERS.has(store?.role ?? "") ? <StoreSync /> : <div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>}
    </div>
  );
}

/** Send Mizan's count to the store (Shopify), so it never sells what's reserved or gone. */
function StoreSync() {
  const t = useTranslations("stock.sync");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["inventorySettings", user?.uid ?? "", store?.tenantId ?? ""];
  const q = useQuery({ queryKey: key, queryFn: () => ok(api.GET("/v1/settings/inventory")) });
  const save = useMutation({
    mutationFn: (pushToStore: boolean) => ok(api.PUT("/v1/settings/inventory", { body: { pushToStore } })),
    onSuccess: (r) => { qc.setQueryData(key, r); toast.event({ type: null, message: r.pushToStore ? t("on") : t("off") }); },
  });
  // A failed load is not "off": say it could not be read instead of showing a switched-off toggle.
  if (q.isError && !q.data) {
    return <div className="mz-card" data-testid="stock-sync"><ErrorState compact error={q.error} onRetry={() => void q.refetch()} retrying={q.isRefetching} /></div>;
  }
  return (
    <div className="mz-card p-4" data-testid="stock-sync">
      <Switch label={t("label")} description={t("description")} checked={q.data?.pushToStore ?? false} disabled={!q.data || save.isPending}
        onChange={(e) => save.mutate(e.target.checked)} />
    </div>
  );
}

