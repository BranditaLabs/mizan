import { MoneySchema } from "@mizan/shared";
import { z } from "zod";

export const BOOKING_STATES = ["pending", "booked", "failed"] as const;
/** Why a booking failed: the courier's or the order's reason, stable for the UI. */
export const BOOKING_ERRORS = ["city_unknown", "address_invalid", "payment_blocks", "cancelled", "not_found", "courier_refused_key", "courier_failed"] as const;

export const ShipmentSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  provider: z.string(),
  booking: z.enum(BOOKING_STATES).describe("pending: the courier is being booked; booked: it has a tracking number; failed: see error"),
  status: z.string().describe("The courier's status, canonical (created, pickup_requested … delivered, returned)"),
  trackingNumber: z.string().nullable(),
  trackingUrl: z.string().nullable(),
  cod: MoneySchema.describe("Cash the courier collects (cashToCollect: 0 when prepaid, the balance for a deposit)"),
  error: z.object({ code: z.enum(BOOKING_ERRORS), message: z.string() }).nullable(),
  requestedAt: z.iso.datetime(),
  bookedAt: z.iso.datetime().nullable(),
});
export type ShipmentView = z.output<typeof ShipmentSchema>;
