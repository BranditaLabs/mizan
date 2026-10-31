import { MoneySchema } from "@mizan/shared";
import { z } from "zod";
import { NewOrderSchema } from "../orders/orders.dto.js";
import { TICKET_REASONS } from "../tickets/tickets.rules.js";

export const NewExchangeSchema = z.strictObject({
  orderId: z.uuid().describe("The delivered order the items come back from"),
  items: z.array(z.strictObject({ lineId: z.uuid(), quantity: z.number().int().min(1).max(999) })).min(1).max(50).describe("What comes back"),
  lines: NewOrderSchema.shape.lines.describe("What the customer gets instead (catalogue products or titled items with a price)"),
  shipping: NewOrderSchema.shape.shipping.describe("What the customer pays for the exchange's shipping (0 when the store pays)"),
  reason: z.enum(TICKET_REASONS),
  note: z.string().trim().min(1).max(300).optional(),
  ticketId: z.uuid().optional().describe("The case this exchange settles"),
});
export type NewExchange = z.output<typeof NewExchangeSchema>;

export const ExchangeSchema = z.object({
  id: z.uuid(),
  original: z.object({ id: z.uuid(), number: z.string() }),
  replacement: z.object({ id: z.uuid(), number: z.string(), status: z.string() }),
  reason: z.enum(TICKET_REASONS),
  note: z.string().nullable(),
  status: z.enum(["awaiting_return", "returned"]).describe("awaiting_return until the return inspection on the original covers every item"),
  items: z.array(z.object({ lineId: z.uuid(), title: z.string(), quantity: z.number().int() })),
  returnedValue: MoneySchema.describe("What the returned items cost the customer"),
  credit: MoneySchema.describe("Moved to the replacement as store credit (money the customer already paid)"),
  toCollect: MoneySchema.describe("The difference the courier collects on the replacement"),
  refundDue: MoneySchema.describe("Credit left over when the replacement costs less: refund it from the original"),
  createdAt: z.iso.datetime(),
  returnedAt: z.iso.datetime().nullable(),
});
export type ExchangeView = z.output<typeof ExchangeSchema>;
export const OrderExchangesSchema = z.object({
  outgoing: z.array(ExchangeSchema).describe("Exchanges made from this order"),
  exchangeOf: ExchangeSchema.nullable().describe("When this order is a replacement: the exchange it settles"),
});
