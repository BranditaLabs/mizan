import { MoneySchema } from "@mizan/shared";
import { z } from "zod";
import { NewOrderSchema } from "../orders/orders.dto.js";

/** Why a customer refused at the door (E10-4): the ticket reasons that can happen there. */
export const REFUSAL_REASONS = ["changed_mind", "wrong_item", "wrong_size", "damaged", "not_as_described", "quality", "price", "late_delivery", "courier_behaviour", "other"] as const;

const Amount = NewOrderSchema.shape.shipping.unwrap();
export const PartialDeliverySchema = z.strictObject({
  kept: z.array(z.strictObject({ lineId: z.uuid(), quantity: z.number().int().min(1).max(999) })).min(1).max(50).describe("What the customer kept; the rest comes back"),
  collected: Amount.optional().describe("Cash the courier collected (default: what the kept items still owe)"),
  note: z.string().trim().min(1).max(300).optional(),
});
export type PartialDeliveryBody = z.output<typeof PartialDeliverySchema>;

export const RefusalSchema = z.strictObject({
  reason: z.enum(REFUSAL_REASONS),
  openBox: z.boolean().describe("The customer opened the parcel to inspect it before refusing (المعاينة)"),
  note: z.string().trim().min(1).max(300).optional(),
});
export type RefusalBody = z.output<typeof RefusalSchema>;

const Item = z.object({ lineId: z.uuid(), title: z.string(), quantity: z.number().int() });
export const PartialDeliveredSchema = z.object({
  orderId: z.uuid(),
  status: z.string(),
  due: MoneySchema.describe("What the customer owes now: the kept items, plus shipping, less discount"),
  collected: MoneySchema.describe("Cash the courier collected (in the ledger)"),
  refundDue: MoneySchema.describe("Paid beforehand beyond what they kept"),
  kept: z.array(Item),
  comingBack: z.array(Item).describe("Inspect these when they arrive (return inspection)"),
});
export const RefusalRecordedSchema = z.object({ orderId: z.uuid(), reason: z.enum(REFUSAL_REASONS), openBox: z.boolean(), at: z.iso.datetime() });
