import { z } from "zod";
import {
  PAYMENT_MODES, PAYMENT_STATUSES, PRODUCT_STATUSES, SHIPMENT_STATUSES,
  type Address, type CanonicalOrder, type CanonicalProduct, type CanonicalShipment,
  type CanonicalVariant, type ConnectorId, type FulfillmentGroup, type Money,
  type OrderLine, type ProductPatch,
} from "./model.js";
import { isCurrencyCode, isDecimalAmount } from "./money.js";

/**
 * Zod schemas for the canonical model, used to validate data crossing a
 * trust boundary (API requests, queued job payloads, imported files).
 * Each schema is checked against its TypeScript interface with `satisfies`,
 * so the two cannot drift apart silently.
 */

const isoDateTime = z.iso.datetime({ offset: true });

export const CurrencyCodeSchema = z.string().refine(isCurrencyCode, "must be an ISO 4217 code such as EGP");

export const MoneySchema = z.object({
  amount: z.string().refine(isDecimalAmount, 'must be a decimal string such as "1150.00"'),
  currency: CurrencyCodeSchema,
}) satisfies z.ZodType<Money>;

export const ConnectorIdSchema = z.string().min(1) as z.ZodType<ConnectorId>;
export const PaymentModeSchema = z.enum(PAYMENT_MODES);
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);
export const ShipmentStatusSchema = z.enum(SHIPMENT_STATUSES);
export const ProductStatusSchema = z.enum(PRODUCT_STATUSES);

export const AddressSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  line1: z.string(),
  line2: z.string().optional(),
  city: z.string(),
  province: z.string().optional(),
  zip: z.string().optional(),
  countryCode: z.string().length(2),
}) satisfies z.ZodType<Address>;

export const OrderLineSchema = z.object({
  externalLineId: z.string().min(1),
  sku: z.string().optional(),
  variantExternalId: z.string().optional(),
  title: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: MoneySchema,
}) satisfies z.ZodType<OrderLine>;

export const FulfillmentGroupSchema = z.object({
  externalId: z.string().min(1),
  status: z.string(),
  lineIds: z.array(z.string()),
}) satisfies z.ZodType<FulfillmentGroup>;

export const CanonicalOrderSchema = z.object({
  connector: ConnectorIdSchema,
  externalId: z.string().min(1),
  number: z.string().min(1),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  currency: CurrencyCodeSchema,
  total: MoneySchema,
  subtotal: MoneySchema.optional(),
  shipping: MoneySchema.optional(),
  paymentMode: PaymentModeSchema,
  paymentStatus: PaymentStatusSchema,
  financialStatus: z.string().optional(),
  gateways: z.array(z.string()),
  received: MoneySchema.optional(),
  outstanding: MoneySchema.optional(),
  refunded: MoneySchema.optional(),
  cancelled: z.boolean(),
  customer: z.object({ name: z.string(), phone: z.string().optional(), email: z.string().optional() }),
  shippingAddress: AddressSchema.optional(),
  lines: z.array(OrderLineSchema),
  fulfillmentGroups: z.array(FulfillmentGroupSchema),
  tags: z.array(z.string()),
  raw: z.unknown().optional(),
}) satisfies z.ZodType<CanonicalOrder>;

export const CanonicalVariantSchema = z.object({
  externalId: z.string().min(1),
  sku: z.string().optional(),
  title: z.string().optional(),
  price: MoneySchema,
  compareAtPrice: MoneySchema.nullable().optional(),
  inventoryItemId: z.string().optional(),
  available: z.number().int().optional(),
}) satisfies z.ZodType<CanonicalVariant>;

export const CanonicalProductSchema = z.object({
  connector: ConnectorIdSchema,
  externalId: z.string().min(1),
  title: z.string(),
  status: ProductStatusSchema,
  vendor: z.string().optional(),
  productType: z.string().optional(),
  tags: z.array(z.string()),
  descriptionHtml: z.string().optional(),
  variants: z.array(CanonicalVariantSchema),
  updatedAt: isoDateTime,
  raw: z.unknown().optional(),
}) satisfies z.ZodType<CanonicalProduct>;

export const CanonicalShipmentSchema = z.object({
  connector: ConnectorIdSchema,
  externalId: z.string().min(1),
  trackingNumber: z.string().min(1),
  orderRef: z.string().min(1),
  status: ShipmentStatusSchema,
  rawStatus: z.object({ code: z.union([z.string(), z.number()]).optional(), label: z.string().optional() }),
  cod: MoneySchema,
  trackingUrl: z.string().optional(),
  updatedAt: isoDateTime,
  raw: z.unknown().optional(),
}) satisfies z.ZodType<CanonicalShipment>;

export const ProductPatchSchema = z.object({
  productExternalId: z.string().min(1),
  title: z.string().optional(),
  descriptionHtml: z.string().optional(),
  status: ProductStatusSchema.optional(),
  tags: z.array(z.string()).optional(),
  variants: z.array(z.object({
    externalId: z.string().min(1),
    price: MoneySchema.optional(),
    compareAtPrice: MoneySchema.nullable().optional(),
  })).optional(),
  inventory: z.array(z.object({
    inventoryItemId: z.string().min(1),
    locationId: z.string().min(1),
    available: z.number().int(),
  })).optional(),
}) satisfies z.ZodType<ProductPatch>;
