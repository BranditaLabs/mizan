"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, IconButton } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { Card } from "@/components/ui/Surface";
import { ErrorState } from "@/components/ui/QueryState";
import { ApiError, idempotency, ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { latin } from "@/lib/rich";
import { PRODUCT_EDITORS } from "./EditProduct";
import { ProductImage } from "./ProductImage";

type Product = Schemas["ProductDetail"];
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PICTURE_ERRORS = new Set(["publishing", "picture_type", "picture_too_small", "picture_too_large", "picture_unreadable", "too_many_pictures", "payload_too_large"]);
const PUBLISH_ERRORS = new Set(["publishing", "not_a_store", "store_not_active", "variants_invalid"]);

/** P3: a product made in Mizan gets its pictures here (a store's product gets them in the store). */
export function PicturesCard({ product: p }: { product: Product }) {
  const t = useTranslations("products.pictures");
  const tpr = useTranslations("problems");
  const { api, store } = useSession();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const keys = useRef(new WeakMap<File, string>());
  const [error, setError] = useState<ReactNode>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["products"] });
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      // One at a time, in the order chosen: the first of a product's pictures is its main one. Each
      // file has its own key, so one sent again (a lost answer) is the same picture, never a copy.
      for (const f of files) {
        if (!TYPES.has(f.type)) throw new ApiError(415, "picture_type", "");
        if (!keys.current.has(f)) keys.current.set(f, crypto.randomUUID());
        await ok(api.POST("/v1/products/{id}/images", {
          params: { path: { id: p.id } }, body: f as never, bodySerializer: (b: unknown) => b as File,
          headers: { "Content-Type": f.type, ...idempotency(keys.current.get(f)!) },
        }));
      }
    },
    retry: false,
    onSettled: async () => { if (input.current) input.current.value = ""; await refresh(); },
    onError: (e) => setError(e instanceof ApiError && PICTURE_ERRORS.has(e.code) ? t.rich(`errors.${e.code as "picture_type"}`, latin) : problemText(e, tpr)),
    meta: { toast: false },
  });
  const remove = useMutation({
    mutationFn: (imageId: string) => ok(api.DELETE("/v1/products/{id}/images/{imageId}", { params: { path: { id: p.id, imageId } } })),
    onSuccess: refresh,
  });
  const canEdit = PRODUCT_EDITORS.has(store?.role ?? "");

  return (
    <Card title={t("title")} actions={canEdit ? (
      <>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label={t("choose")} data-testid="picture-input"
          onChange={(e) => { setError(null); const files = [...(e.target.files ?? [])]; if (files.length) upload.mutate(files); }} />
        <Button size="sm" variant="secondary" icon="upload" busy={upload.isPending} pending="fill" onClick={() => input.current?.click()}>{t("add")}</Button>
      </>
    ) : null}>
      <div className="flex flex-col gap-3" data-testid="pictures-card">
        <p className="text-caption text-text-3">{t.rich("hint", latin)}</p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {p.images.length === 0 ? <p className="text-body-sm text-text-2">{t("none")}</p> : (
          <ul className="flex flex-wrap gap-3">
            {p.images.map((img) => (
              <li key={img.id} className="flex flex-col items-center gap-1">
                <ProductImage image={{ ...img, url: img.thumbUrl ?? img.url }} alt={p.title} size={96} />
                <span className="text-caption text-text-3">{img.isMain ? t("main") : null}</span>
                {canEdit ? <IconButton icon="delete" size="sm" label={t("remove")} disabled={remove.isPending} onClick={() => remove.mutate(img.id)} /> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/** P3: put a product made in Mizan on a connected store; it becomes that store's once the store has it. */
export function PublishCard({ product: p }: { product: Product }) {
  const t = useTranslations("products.publish");
  const tpr = useTranslations("problems");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const stores = useQuery({
    queryKey: ["connections", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/connections")),
    enabled: Boolean(store),
    select: (d) => d.data.filter((c) => c.kind === "store" && (c.provider === "shopify" || c.provider === "woocommerce") && c.status === "active"),
  });
  const [choice, setChoice] = useState("");
  const target = choice || stores.data?.[0]?.id || "";
  const publish = useMutation({
    mutationFn: () => ok(api.POST("/v1/products/{id}/publish", { params: { path: { id: p.id } }, body: { connectionId: target } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
    meta: { toast: false },
  });
  const canEdit = PRODUCT_EDITORS.has(store?.role ?? "");
  const state = p.publish?.status;
  const name = (c: Schemas["Connection"]) => `${c.provider === "woocommerce" ? "WooCommerce" : "Shopify"} · ${c.account ?? ""}`;

  return (
    <Card title={t("title")}>
      <div className="flex flex-col gap-3" data-testid="publish-card">
        <p className="text-body-sm text-text-2">{t("body")}</p>
        {state === "publishing" ? <Alert tone="info">{t("publishing")}</Alert> : null}
        {state === "failed" ? <Alert tone="danger">{t("failed", { message: p.publish?.error ?? "" })}</Alert> : null}
        {/* The store list failed to load: say so, never "no store connected". */}
        {stores.isError && !stores.data ? <ErrorState compact error={stores.error} onRetry={() => void stores.refetch()} retrying={stores.isRefetching} /> : null}
        {stores.data && stores.data.length === 0 ? <p className="text-body-sm text-text-2">{t("noStore")}</p> : null}
        {canEdit && stores.data?.length && state !== "publishing" ? (
          <div className="flex flex-wrap items-end gap-3">
            <Select label={t("store")} value={target} onChange={(e) => setChoice(e.target.value)} className="min-w-56">
              {stores.data.map((c) => <option key={c.id} value={c.id}>{name(c)}</option>)}
            </Select>
            <Button icon="upload" busy={publish.isPending} disabled={!target} onClick={() => publish.mutate()}>{state === "failed" ? t("again") : t("go")}</Button>
          </div>
        ) : null}
        {/* Shopify adds a new product to no sales channel; putting it on one needs a permission Mizan does not ask for yet. */}
        {state === "published" && p.store?.provider === "shopify" && p.publish?.onlineStore === false ? <p className="text-caption text-text-3">{t("shopifyChannels")}</p> : null}
        {publish.isError ? <Alert tone="danger">{publish.error instanceof ApiError && PUBLISH_ERRORS.has(publish.error.code) ? t(`errors.${publish.error.code as "publishing"}`) : problemText(publish.error, tpr)}</Alert> : null}
      </div>
    </Card>
  );
}
