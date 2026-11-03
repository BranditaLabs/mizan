/**
 * A product made in Mizan, published to a store (P3). The platform hands it to the engine when the
 * job runs (`loadProductDraft`). Money is a decimal string in `currency`; pictures are public URLs
 * the store fetches itself. `handle` is the product's URL name in the store, made unique with a
 * piece of Mizan's id: the engine finds a product it already created by it before creating one.
 */
export interface ProductDraft {
  /** Mizan's product id. */
  productId: string;
  title: string;
  handle: string;
  descriptionHtml?: string | undefined;
  status: "active" | "draft" | "archived";
  vendor?: string | undefined;
  productType?: string | undefined;
  tags: string[];
  /** Up to three options and their values, in order; empty for a product with one variant. */
  options: Array<{ name: string; values: string[] }>;
  variants: Array<{
    /** Mizan's variant id. */
    variantId: string;
    sku: string;
    price: string;
    compareAtPrice?: string | undefined;
    barcode?: string | undefined;
    options: Array<{ name: string; value: string }>;
  }>;
  /** In order; the first is the main picture. */
  images: Array<{ imageId: string; url: string; alt?: string | undefined }>;
  currency: string;
}

/** Created (now, or found from an earlier attempt), with the store's ids; or why not (final). */
export type ProductPublishOutcome =
  | {
    ok: true; outcome: "created" | "already_created"; externalId: string;
    /** Mizan variant id → the store's variant id. */
    variants: Record<string, string>;
    /** Mizan picture id → the store's picture id (those the store took). */
    images: Record<string, string>;
  }
  | { ok: false; reason: "validation" | "permission" | "failed"; message: string };

/** What the connectors return; the engine adds the outcome. */
export type CreatedProduct = Omit<Extract<ProductPublishOutcome, { ok: true }>, "ok">;

/** "Linen Abaya" + id → "linen-abaya-1a2b3c4d": the store's URL name, unique to this product. */
export function draftHandle(title: string, productId: string): string {
  // Latin letters and digits only (an Arabic title gives "product-…"): both stores take that as is.
  const base = title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "product";
  return `${base}-${productId.replace(/-/g, "").slice(0, 8)}`;
}
