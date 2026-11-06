/**
 * An order made in Mizan (typed by the team), created in the store too so both keep the same
 * record. Read when the job runs (`loadStoreOrderDraft`): the address and phone never sit in a job.
 * Money is a decimal string in `currency`. The store's copy carries Mizan's id in a unique field,
 * so it is found again (never created twice) and recognised when the store sends it back.
 */
export interface StoreOrderDraft {
  /** Mizan's order id: the unique key in the store. */
  orderId: string;
  /** Mizan's number (M-1001): the store's order is named the same. */
  number: string;
  currency: string;
  lines: Array<{ variantExternalId?: string; title: string; sku?: string | null; quantity: number; unitPrice: string; /** The catalogue price (what the store charges for the variant). */ listPrice?: string }>;
  shipping: string;
  discount: string;
  /** What was paid already (a deposit, a transfer, a prepaid order), recorded as one payment in the store. */
  paid: string;
  financialStatus: "PENDING" | "PARTIALLY_PAID" | "PAID";
  /** The buyer as a store customer (found by phone or email, else created), so the order sits in their history. */
  customer?: { firstName: string; lastName?: string; phone?: string; email?: string };
  address: { firstName: string; lastName?: string; phone?: string; line1: string; line2?: string; city: string; province?: string; provinceCode?: string; countryCode: string };
  phone?: string;
  tags: string[];
  note?: string;
  /** Shown on the store's order ("Location" → a map link to the customer's pin). */
  attributes?: Array<{ key: string; value: string }>;
}

export type StoreOrderOutcome =
  | { ok: true; externalId: string; name: string; outcome: "created" | "already_created" }
  | { ok: false; reason: "validation" | "permission" | "failed"; message: string };

/** The store order's marker for Mizan's id (Shopify `sourceIdentifier`). */
export const mizanOrderRef = (orderId: string) => `mizan:${orderId}`;
export function mizanOrderIdOf(ref: string | null | undefined): string | undefined {
  const m = /^mizan:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(ref ?? "");
  return m?.[1]?.toLowerCase();
}
