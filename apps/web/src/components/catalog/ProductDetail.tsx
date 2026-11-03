"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Bdi } from "@/components/Bdi";
import { Badge, Tag } from "@/components/ui/Badge";
import { Button, buttonClass } from "@/components/ui/Button";
import { Cell, DataTable, IdCell, type Column } from "@/components/ui/DataTable";
import { StatCard } from "@/components/ui/StatCard";
import { Card, EmptyState, KeyValue, SkeletonRows } from "@/components/ui/Surface";
import { cx } from "@/components/ui/logic";
import { DateText, MoneyText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { ProductImage } from "./ProductImage";
import { EditVariant } from "./Products";

type Product = Schemas["ProductDetail"];
type Variant = Product["variants"][number];
type Image = Product["images"][number];

const STATUS_TONE = { active: "success", draft: "neutral", archived: "neutral" } as const;

/**
 * One product in full (P1): its pictures with the main one, what the store says about it (options,
 * vendor, type, tags, description), every variant with its option values, picture, price, cost,
 * barcode and stock, and what is still missing. Store fields are edited in the store (the link
 * opens it); the cost and barcode are Mizan's and are edited here.
 */
export function ProductDetail({ id }: { id: string }) {
  const t = useTranslations("products");
  const tpr = useTranslations("problems");
  const locale = useLocale();
  const list = (values: string[]) => new Intl.ListFormat(locale, { type: "unit", style: "short" }).format(values);
  const { api, user, store } = useSession();
  const [editing, setEditing] = useState<Variant | null>(null);
  const product = useQuery({
    queryKey: ["products", "detail", user?.uid ?? "", store?.tenantId ?? "", id],
    queryFn: () => ok(api.GET("/v1/products/{id}", { params: { path: { id } } })),
    enabled: Boolean(store),
    meta: { toast: false },
  });

  const back = (
    <Link href="/products" className="inline-flex items-center gap-1.5 text-body-sm text-text-2 hover:text-text">
      <Icon name="back" size={16} />{t("detail.back")}
    </Link>
  );
  if (product.isPending) return <Page>{back}<div className="mz-card"><SkeletonRows rows={6} label={t("loading")} /></div></Page>;
  if (product.isError) {
    const missing = product.error instanceof ApiError && (product.error.status === 404 || product.error.status === 400);
    const denied = product.error instanceof ApiError && product.error.status === 403;
    return (
      <Page>
        {back}
        <div className="mz-card">
          {missing ? <EmptyState icon="product" title={t("detail.notFound.title")} body={t("detail.notFound.body")} />
            : denied ? <EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} />
            : <EmptyState icon="error" title={problemText(product.error, tpr)} body="" action={<Button variant="secondary" onClick={() => void product.refetch()}>{tpr("retry")}</Button>} />}
        </div>
      </Page>
    );
  }

  const p = product.data;
  const pictureOf = (v: Variant) => p.images.find((i) => i.id === v.imageId) ?? null;
  const columns: Column<Variant>[] = [
    {
      id: "variant", header: t("col.variant"),
      cell: (v) => (
        <div className="flex items-center gap-3">
          <ProductImage image={pictureOf(v) ?? p.images.find((i) => i.isMain) ?? null} alt={p.title} size={40} />
          <Cell main={v.options.length ? v.options.map((o) => o.value).join(" / ") : v.title ?? t("detail.single")}
            sub={v.options.length ? v.options.map((o) => o.name).join(" / ") : null} />
        </div>
      ),
    },
    { id: "sku", header: t("col.sku"), cell: (v) => <IdCell>{v.sku}</IdCell> },
    {
      id: "barcode", header: t("col.barcode"),
      cell: (v) => (v.barcode ? <Cell main={<IdCell>{v.barcode}</IdCell>} sub={t(`owner.${v.barcodeOwner}`)} /> : <span className="text-text-3">{t("none")}</span>),
    },
    {
      id: "price", header: t("col.price"), numeric: true, sortValue: (v) => Number(v.price.amount),
      cell: (v) => (
        <Cell main={<MoneyText money={v.price} />} sub={v.compareAt ? <span className="line-through"><MoneyText money={v.compareAt} /></span> : null} />
      ),
    },
    {
      id: "cost", header: t("col.cost"), numeric: true, sortValue: (v) => (v.cost ? Number(v.cost.amount) : -1),
      cell: (v) => (v.cost ? <MoneyText money={v.cost} /> : <Badge tone="warning">{t("missingCost")}</Badge>),
    },
    {
      id: "margin", header: t("col.margin"), numeric: true,
      cell: (v) => {
        const m = margin(v);
        return m === null ? <span className="text-text-3">{t("none")}</span> : <Bdi>{t("detail.marginValue", { value: m })}</Bdi>;
      },
    },
    { id: "stock", header: t("col.stock"), numeric: true, cell: (v) => (v.available === null ? <span className="text-text-3">{t("none")}</span> : <Bdi>{v.available}</Bdi>) },
    {
      id: "edit", header: t("col.actions"),
      cell: (v) => <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(v)} aria-label={t("editLabel", { sku: v.sku })}>{t("edit")}</Button>,
    },
  ];

  const price = p.totals.priceMin && p.totals.priceMax
    ? p.totals.priceMin.amount === p.totals.priceMax.amount
      ? <MoneyText money={p.totals.priceMin} />
      : <span className="inline-flex flex-wrap items-baseline gap-1">{t.rich("detail.priceRange", { min: () => <MoneyText money={p.totals.priceMin!} />, max: () => <MoneyText money={p.totals.priceMax!} /> })}</span>
    : "—";

  return (
    <Page>
      {back}
      <header className="flex flex-wrap items-start justify-between gap-3" data-testid="product-detail">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-heading-lg">{p.title}</h1>
            <Badge tone={STATUS_TONE[p.status]}>{t(`statusName.${p.status}`)}</Badge>
          </div>
          <p className="mt-1 text-body-sm text-text-2">
            {p.store ? t("detail.from", { store: p.store.name }) : t("detail.inMizan")}
            {" · "}{t("detail.updated")} <DateText value={p.updatedAt} relative />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/orders?productId=${p.id}`} className={buttonClass("secondary")}>
            <Icon name="orders" size={16} />{t("detail.orders")}
          </Link>
          {p.storeUrl ? (
            <a href={p.storeUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary")}>
              <Icon name="external" size={16} />{t(`detail.editIn.${p.store?.provider === "woocommerce" ? "woocommerce" : "shopify"}`)}
            </a>
          ) : null}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Gallery images={p.images} title={p.title} />
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label={t("detail.price")} value={price} />
            <StatCard label={t("count.variants")} value={p.totals.variants} />
            <StatCard label={t("detail.stock")} value={p.totals.available ?? "—"} />
            <StatCard label={t("count.missingCost")} value={p.totals.missingCost} />
          </div>
          <Card title={t("detail.about")}>
            <KeyValue items={[
              { label: t("detail.vendor"), value: p.vendor ?? <span className="text-text-3">{t("none")}</span> },
              { label: t("detail.type"), value: p.productType ?? <span className="text-text-3">{t("none")}</span> },
              {
                label: t("detail.options"),
                value: p.options.length
                  ? <ul className="flex flex-col gap-1">{p.options.map((o) => <li key={o.name}><span className="text-text-2">{o.name}:</span> <Bdi>{list(o.values)}</Bdi></li>)}</ul>
                  : <span className="text-text-3">{t("detail.noOptions")}</span>,
              },
              {
                label: t("detail.tags"),
                value: p.tags.length ? <span className="flex flex-wrap gap-1.5">{p.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</span> : <span className="text-text-3">{t("none")}</span>,
              },
              ...(p.handle ? [{ label: t("detail.handle"), value: <IdCell>{p.handle}</IdCell> }] : []),
            ]} />
          </Card>
          <Card title={t("detail.description")}>
            {p.description
              ? <p className="max-w-[75ch] whitespace-pre-line text-body-sm text-text-2" data-testid="product-description">{p.description}</p>
              : <p className="text-body-sm text-text-3">{t("detail.noDescription")}</p>}
          </Card>
        </div>
      </div>

      <Card title={t("detail.variants", { count: p.totals.variants })} bodyClassName="p-0">
        <DataTable label={t("detail.variants", { count: p.totals.variants })} columns={columns} rows={p.variants} rowKey={(v) => v.id} rowLabel={(v) => v.sku}
          empty={<EmptyState icon="product" title={t("detail.noVariants")} body="" />} />
      </Card>
      <p className="text-caption text-text-3">{t("ownership")}</p>
      {editing ? <EditVariant row={{ product: { title: p.title }, variant: editing }} onClose={() => setEditing(null)} /> : null}
    </Page>
  );
}

/** The main picture large, the others as thumbnails in the store's order; choosing one shows it. */
function Gallery({ images, title }: { images: Image[]; title: string }) {
  const t = useTranslations("products.detail");
  const main = images.find((i) => i.isMain) ?? images[0] ?? null;
  const [shown, setShown] = useState<string | null>(null);
  const current = images.find((i) => i.id === shown) ?? main;
  if (!current) {
    return (
      <div className="mz-card flex aspect-square items-center justify-center" data-testid="product-gallery">
        <EmptyState icon="product" title={t("noPictures.title")} body={t("noPictures.body")} />
      </div>
    );
  }
  return (
    <section className="flex flex-col gap-3" aria-label={t("pictures", { count: images.length })} data-testid="product-gallery">
      <div className="relative">
        <ProductImage image={current} alt={title} size={560} className="aspect-square !h-auto !w-full" />
        {current.isMain ? <span className="absolute start-3 top-3"><Badge tone="ink">{t("main")}</Badge></span> : null}
      </div>
      {images.length > 1 ? (
        <ul className="flex flex-wrap gap-2" role="list">
          {images.map((img, i) => (
            <li key={img.id}>
              <button type="button" onClick={() => setShown(img.id)} aria-pressed={img.id === current.id}
                aria-label={t("showPicture", { n: i + 1, total: images.length })}
                className={cx("rounded-md border-2 p-0.5", img.id === current.id ? "border-line-strong" : "border-transparent opacity-80 hover:opacity-100")}>
                <ProductImage image={img} alt={title} size={64} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Gross margin on the price, when the cost is known (whole percent). */
function margin(v: Variant): number | null {
  if (!v.cost || v.cost.currency !== v.price.currency) return null;
  const price = Number(v.price.amount);
  if (!(price > 0)) return null;
  return Math.round(((price - Number(v.cost.amount)) / price) * 100);
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6">{children}</div>;
}
