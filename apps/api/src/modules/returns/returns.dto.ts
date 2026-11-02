import { z } from "zod";

export const INSPECTION_OUTCOMES = ["restock", "damaged", "write_off"] as const;
export type InspectionOutcome = (typeof INSPECTION_OUTCOMES)[number];

export const InspectSchema = z.object({
  items: z.array(z.object({
    lineId: z.uuid().describe("The order line that came back"),
    quantity: z.number().int().min(1).max(10_000),
    outcome: z.enum(INSPECTION_OUTCOMES).describe("restock: sellable, back into stock; damaged; write_off: thrown away"),
  }).strict()).min(1).max(100),
  note: z.string().trim().min(1).max(300).optional(),
  ticketId: z.uuid().optional().describe("The return or exchange ticket it settles; it must be on the same order"),
}).strict();
export type InspectBody = z.output<typeof InspectSchema>;

export const ReturnStateSchema = z.object({
  orderId: z.uuid(),
  eligible: z.boolean().describe("Returned, or delivered and sent back by the customer"),
  canInspect: z.boolean().describe("Whether the caller may record an inspection"),
  lines: z.array(z.object({
    lineId: z.uuid(),
    title: z.string(),
    sku: z.string().nullable(),
    variantId: z.uuid().nullable(),
    quantity: z.number().int(),
    restock: z.number().int(),
    damaged: z.number().int(),
    writeOff: z.number().int(),
    remaining: z.number().int().describe("Units not inspected yet"),
  })),
  inspections: z.array(z.object({
    id: z.uuid(),
    lineId: z.uuid(),
    title: z.string(),
    quantity: z.number().int(),
    outcome: z.enum(INSPECTION_OUTCOMES),
    note: z.string().nullable(),
    by: z.string().nullable(),
    at: z.iso.datetime(),
  })).describe("Newest first"),
});
export type ReturnState = z.output<typeof ReturnStateSchema>;
