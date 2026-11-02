"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Bdi } from "@/components/Bdi";
import { Switch } from "@/components/ui/Choice";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { SettingsTabs } from "./SettingsTabs";

const EDITORS = new Set(["owner", "admin"]);
type Sync = Schemas["StoreSync"];
const SWITCHES = ["progressEvents", "markPaidOnDelivery", "tagReturned", "tagLost"] as const;

/** One Shopify store's switches: what Mizan writes back to it as the courier reports (E7-7). */
function StoreSyncCard({ id, shop }: { id: string; shop: string }) {
  const t = useTranslations("storeSync");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["storeSync", user?.uid ?? "", store?.tenantId ?? "", id];
  const q = useQuery({ queryKey: key, queryFn: () => ok(api.GET("/v1/connections/{id}/sync", { params: { path: { id } } })) });
  const save = useMutation({
    mutationFn: (change: Partial<Sync>) => ok(api.PUT("/v1/connections/{id}/sync", { params: { path: { id } }, body: change })),
    onSuccess: (data) => { qc.setQueryData(key, data); toast({ message: t("saved") }); },
  });
  return (
    <section className="mz-card p-5" data-testid="store-sync">
      <h2 className="text-heading-sm"><Bdi code>{shop}</Bdi></h2>
      {!q.data ? <SkeletonRows rows={2} label={t("loading")} /> : (
        <div className="mt-3 flex flex-col gap-4">
          {SWITCHES.map((k) => (
            <Switch key={k} label={t(`${k}.label`)} description={t(`${k}.hint`)} checked={q.data[k]} disabled={save.isPending}
              onChange={(e) => save.mutate({ [k]: e.target.checked })} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Settings → Store sync (E7-7): per Shopify store, what reaches the customer's order page as the courier reports. */
export function StoreSyncScreen() {
  const t = useTranslations("storeSync");
  const { api, user, store } = useSession();
  const role = store?.role ?? "";
  const list = useQuery({
    queryKey: ["connections", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/connections")),
    enabled: EDITORS.has(role),
  });
  const stores = (list.data?.data ?? []).filter((c) => c.provider === "shopify" && c.status !== "disconnected");
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6">
      <SettingsTabs />
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {!EDITORS.has(role) ? <div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>
        : !list.data ? <div className="mz-card"><SkeletonRows rows={2} label={t("loading")} /></div>
        : !stores.length ? <div className="mz-card"><EmptyState icon="cart" title={t("none.title")} body={t("none.body")} /></div>
        : stores.map((c) => <StoreSyncCard key={c.id} id={c.id} shop={c.account ?? c.id} />)}
    </div>
  );
}
