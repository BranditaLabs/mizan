/**
 * Canonical model.
 *
 * Every connector translates its platform's data into these shapes and back.
 * The engine, the database and the rest of Mizan only ever see canonical
 * objects, so a change in Shopify's or Bosta's payloads is absorbed inside
 * one adapter instead of leaking across the product.
 */

export type ConnectorId = "shopify" | "bosta" | (string & {});

export interface Money {
  /** Decimal string, never a float: "1150.00". */
  amount: string;
  currency: string;
}

export interface Address {
  name?: string;
  phone?: string;
  line1: string;
  line2?: string;
  city: string;
  province?: string;
  zip?: string;
  countryCode: string;
}

export interface OrderLine {
  externalLineId: string;
  sku?: string;
  title: string;
  quantity: number;
  unitPrice: Money;
}

export interface FulfillmentGroup {
  /** Shopify fulfillment order id, or equivalent on other platforms. */
  externalId: string;
  status: string;
  lineIds: string[];
}

export type PaymentMode = "cod" | "prepaid" | "unknown";

export interface CanonicalOrder {
  connector: ConnectorId;
  externalId: string;
  number: string;
  createdAt: string;
  updatedAt: string;
  currency: string;
  total: Money;
  subtotal?: Money;
  shipping?: Money;
  paymentMode: PaymentMode;
  financialStatus?: string;
  cancelled: boolean;
  customer: { name: string; phone?: string; email?: string };
  shippingAddress?: Address;
  lines: OrderLine[];
  fulfillmentGroups: FulfillmentGroup[];
  tags: string[];
  /** Raw payload kept for audit and for re-mapping after an adapter fix. */
  raw?: unknown;
}

export interface CanonicalVariant {
  externalId: string;
  sku?: string;
  title?: string;
  price: Money;
  compareAtPrice?: Money | null;
  inventoryItemId?: string;
  available?: number;
}

export interface CanonicalProduct {
  connector: ConnectorId;
  externalId: string;
  title: string;
  status: "active" | "draft" | "archived" | "unknown";
  vendor?: string;
  productType?: string;
  tags: string[];
  descriptionHtml?: string;
  variants: CanonicalVariant[];
  updatedAt: string;
  raw?: unknown;
}

/** Mizan's courier-independent shipment lifecycle. */
export const SHIPMENT_STATUSES = [
  "created",
  "pickup_requested",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "failed_attempt",
  "returning",
  "returned",
  "cancelled",
  "lost",
  "exception",
  "unknown",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const TERMINAL_STATUSES: ReadonlySet<ShipmentStatus> = new Set(["delivered", "returned", "cancelled", "lost"]);

export interface CanonicalShipment {
  connector: ConnectorId;
  externalId: string;
  trackingNumber: string;
  orderRef: string;
  status: ShipmentStatus;
  /** What the courier actually sent, kept verbatim for audit and re-mapping. */
  rawStatus: { code?: string | number; label?: string };
  cod: Money;
  trackingUrl?: string;
  updatedAt: string;
  raw?: unknown;
}

/** A write Mizan wants to make to a product on a commerce platform. */
export interface ProductPatch {
  productExternalId: string;
  title?: string;
  descriptionHtml?: string;
  status?: CanonicalProduct["status"];
  tags?: string[];
  variants?: Array<{
    externalId: string;
    price?: Money;
    compareAtPrice?: Money | null;
  }>;
  inventory?: Array<{
    inventoryItemId: string;
    locationId: string;
    available: number;
  }>;
}
