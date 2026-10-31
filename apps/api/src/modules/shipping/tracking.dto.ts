import { MoneySchema, SHIPMENT_STATUSES } from "@mizan/shared";
import { z } from "zod";

export const SHIPMENT_VIEWS = ["active", "review", "delivered", "returned", "all"] as const;
export type ShipmentListView = (typeof SHIPMENT_VIEWS)[number];
/** Statuses a person can set (rule 7: an ops override); never `unknown` or `exception`. */
export const SETTABLE_STATUSES = SHIPMENT_STATUSES.filter((s) => s !== "unknown" && s !== "exception");

export const ListShipmentsQuerySchema = z.object({
  view: z.enum(SHIPMENT_VIEWS).default("active").describe("active: with the courier; review: an unmapped status or a refused booking; delivered; returned (and returning); all"),
  q: z.string().trim().min(1).max(40).optional().describe("A tracking number or an order number"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});
export type ListShipmentsQuery = z.output<typeof ListShipmentsQuerySchema>;

const Row = z.object({
  id: z.uuid(),
  order: z.object({ id: z.uuid(), number: z.string(), status: z.string() }),
  provider: z.string(),
  booking: z.enum(["pending", "booked", "failed"]),
  status: z.string(),
  statusRaw: z.string().nullable().describe("What the courier sent, verbatim"),
  statusAt: z.iso.datetime().nullable(),
  needsReview: z.boolean(),
  errorCode: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  trackingUrl: z.string().nullable(),
  cod: MoneySchema,
  area: z.object({ city: z.string().nullable(), province: z.string().nullable() }),
  createdAt: z.iso.datetime(),
});
export const ShipmentPageSchema = z.object({
  data: z.array(Row),
  counts: z.object(Object.fromEntries(SHIPMENT_VIEWS.map((v) => [v, z.number().int()])) as Record<ShipmentListView, z.ZodNumber>),
  nextCursor: z.string().nullable(),
});
export type ShipmentPage = z.output<typeof ShipmentPageSchema>;

export const SetStatusSchema = z.object({
  status: z.enum(SETTABLE_STATUSES as unknown as [string, ...string[]]),
  note: z.string().trim().min(1).max(300).optional().describe("Why (what the courier said on the phone, the label seen)"),
});
export type SetStatusBody = z.output<typeof SetStatusSchema>;

export const ShipmentHistorySchema = z.object({
  data: z.array(z.object({ status: z.string(), statusRaw: z.string().nullable(), source: z.enum(["webhook", "poll", "ops"]), at: z.iso.datetime(), note: z.string().nullable() })),
});

export const ImportStatusesSchema = z.strictObject({
  csv: z.string().min(1).max(2_000_000).describe("The courier's report: a header row with the tracking number and the status (canonical, or what couriers write in Arabic or English); date and note optional"),
});
export const StatusesImportedSchema = z.object({
  rows: z.number().int(), changed: z.number().int(), unchanged: z.number().int().describe("Already at that status"), review: z.number().int(),
});

export const ManualShipmentSchema = z.strictObject({
  courier: z.string().trim().min(2).max(60).describe("The courier's name as the team calls it (J&T, Aramex, our own driver…)"),
  trackingNumber: z.string().trim().regex(/^[\w-]{3,64}$/, "letters, digits, - or _").describe("The courier's tracking or waybill number"),
});
