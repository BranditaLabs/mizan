/**
 * A change to a store order before it ships (O3). The platform keeps the edit and hands it to the
 * engine when the job runs (`loadOrderEdit`): the new address is personal data and never goes into
 * a job. Ids are the store's own (order, line, variant). Money is a decimal string in the order's
 * currency.
 */
export interface OrderEditPlan {
  editId: string;
  /** The store's order id. */
  orderId: string;
  currency: string;
  /** Lines already on the order: the new quantity (0 removes it) and, where the store allows it, a new unit price. */
  lines: Array<{ lineId: string; variantId?: string | undefined; quantity: number; unitPrice?: string | undefined }>;
  /** Catalogue items to add, by the store's variant id, at the store's price unless `unitPrice` (where allowed). */
  add: Array<{ variantId: string; quantity: number; unitPrice?: string | undefined }>;
  /** The new delivery fee. */
  shipping?: string | undefined;
  address?: {
    name?: string | undefined; phone?: string | undefined; line1: string; line2?: string | undefined;
    city: string; province?: string | undefined; countryCode?: string | undefined;
    /** ISO subdivision code ("C" for Cairo): what Shopify takes; `province` stays the name (WooCommerce's state). */
    provinceCode?: string | undefined;
  } | undefined;
}

/** Done (now, or by an earlier attempt whose answer was lost), or why not (final: the team changes it in the store). */
export type OrderEditOutcome =
  | { ok: true; outcome: "applied" | "already_applied" }
  | { ok: false; reason: "validation" | "not_found" | "permission" | "failed"; message: string };

/** The marker an applied edit leaves on the store's order, so a repeat is a no-op. */
export const editMarker = (editId: string) => `mizan-edit-${editId}`;
