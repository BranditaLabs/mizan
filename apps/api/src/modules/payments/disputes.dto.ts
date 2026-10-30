import { MoneySchema } from "@mizan/shared";
import { z } from "zod";
import { plainDecimal } from "../../platform/csv.js";

export const DISPUTE_REASONS = ["fraud", "not_received", "not_as_described", "duplicate", "cancelled", "other"] as const;
export const DISPUTE_STATUSES = ["open", "evidence_submitted", "won", "lost", "accepted"] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];
export const OPEN_DISPUTE: readonly DisputeStatus[] = ["open", "evidence_submitted"];

const decimal = (positive: boolean) => z.string().transform((v, ctx) => {
  const d = plainDecimal(v);
  if (!d || (positive && !/[1-9]/.test(d))) {
    ctx.addIssue({ code: "custom", message: positive ? "a positive amount like 250 or 250.50" : "an amount like 0 or 25.50" });
    return z.NEVER;
  }
  return d;
});

/** E14-5: a chargeback the gateway or bank reported, recorded by the team (gateways record their own with E14-2). */
export const NewDisputeSchema = z.strictObject({
  amount: decimal(true).describe("Taken back, in the order's currency; Arabic digits accepted"),
  fee: decimal(false).optional().describe("The gateway's chargeback fee, a cost in profit (0 if none)"),
  reason: z.enum(DISPUTE_REASONS),
  respondBy: z.iso.datetime({ offset: true }).optional().describe("The gateway's deadline for evidence"),
  externalRef: z.string().trim().min(1).max(100).optional().describe("The gateway's case id: one dispute per case"),
  note: z.string().trim().max(500).optional(),
});
export type NewDispute = z.output<typeof NewDisputeSchema>;

export const SubmitEvidenceSchema = z.strictObject({
  note: z.string().trim().max(1000).optional().describe("What was sent and how (portal, email); no card numbers"),
});
export const CloseDisputeSchema = z.strictObject({
  outcome: z.enum(["won", "lost", "accepted"]).describe("won: the money comes back (a reversal line); lost: the gateway kept it; accepted: not contested"),
  note: z.string().trim().max(500).optional(),
});
export type CloseDispute = z.output<typeof CloseDisputeSchema>;

export const ListDisputesQuerySchema = z.object({
  status: z.enum(["open", "closed", "all"]).default("open").describe("open = open or evidence submitted"),
  orderId: z.uuid().optional(),
});
export type ListDisputesQuery = z.output<typeof ListDisputesQuerySchema>;

export const DisputeSchema = z.object({
  id: z.uuid(), number: z.string().describe("D-1001…"),
  order: z.object({ id: z.uuid(), number: z.string() }),
  status: z.enum(DISPUTE_STATUSES), reason: z.enum(DISPUTE_REASONS).nullable(),
  amount: MoneySchema, fee: MoneySchema, method: z.string().nullable(), source: z.enum(["manual", "gateway"]),
  respondBy: z.iso.datetime().nullable(), daysLeft: z.number().int().nullable().describe("Whole days to the deadline while open; negative once missed"),
  externalRef: z.string().nullable(), note: z.string().nullable(), evidenceNote: z.string().nullable(),
  openedBy: z.string().nullable(), evidenceSubmittedAt: z.iso.datetime().nullable(), closedAt: z.iso.datetime().nullable(), createdAt: z.iso.datetime(),
});
export type Dispute = z.infer<typeof DisputeSchema>;
export const DisputeListSchema = z.object({
  data: z.array(DisputeSchema),
  counts: z.record(z.enum(DISPUTE_STATUSES), z.number().int()),
});

/** Everything the gateway asks for, in one place (docs/12 §5.4). Customer contact is minimized: the phone's last digits only. */
export const EvidencePackSchema = z.object({
  dispute: DisputeSchema,
  store: z.object({ name: z.string(), country: z.string() }),
  generatedAt: z.iso.datetime(),
  order: z.object({
    number: z.string(), channel: z.string(), status: z.string(), paymentMode: z.string(), placedAt: z.iso.datetime(),
    confirmedAt: z.iso.datetime().nullable(), shippedAt: z.iso.datetime().nullable(), deliveredAt: z.iso.datetime().nullable(),
    subtotal: MoneySchema, shipping: MoneySchema, discount: MoneySchema, total: MoneySchema,
    lines: z.array(z.object({ title: z.string(), sku: z.string().nullable(), quantity: z.number().int(), unitPrice: MoneySchema, total: MoneySchema })),
  }),
  customer: z.object({
    name: z.string().nullable(), phoneLast4: z.string().nullable(),
    address: z.object({ line1: z.string().nullable(), line2: z.string().nullable(), city: z.string().nullable(), province: z.string().nullable(), country: z.string().nullable() }),
  }).nullable().describe("null when the customer's details were deleted on request"),
  payments: z.array(z.object({ kind: z.string(), method: z.string(), status: z.string(), amount: MoneySchema, at: z.iso.datetime() })),
  shipments: z.array(z.object({
    courier: z.string(), trackingNumber: z.string().nullable(), trackingUrl: z.string().nullable(), status: z.string(), statusAt: z.iso.datetime().nullable(),
    events: z.array(z.object({ status: z.string(), at: z.iso.datetime(), source: z.string() })),
  })),
  confirmation: z.array(z.object({ startedAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(), outcome: z.string().nullable(), channel: z.string().nullable() })),
  messages: z.array(z.object({ at: z.iso.datetime(), direction: z.enum(["in", "out"]), kind: z.string(), action: z.string().nullable(), status: z.string() }))
    .describe("The WhatsApp exchange with the customer: what was sent and tapped, never message bodies"),
});
export type EvidencePack = z.infer<typeof EvidencePackSchema>;
