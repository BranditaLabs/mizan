import { z } from "zod";
import { PLANS } from "../billing/plans.js";
import { TENANT_STATUSES } from "../tenants/tenants.dto.js";

const Plan = z.enum(PLANS);
const Status = z.enum(TENANT_STATUSES);
const Usage = z.object({ month: z.iso.date().describe("First day of a closed month"), orders: z.number().int(), whatsappMessages: z.number().int(), aiOffers: z.number().int(), plan: z.string() });

export const StoresQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional().describe("Name, slug or store id"),
  plan: Plan.optional(),
  status: Status.optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  createdFrom: z.iso.date().optional(),
  createdTo: z.iso.date().optional().describe("Inclusive"),
  sort: z.enum(["newest", "orders"]).default("newest").describe("orders: the last closed month's orders, most first"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

const StoreRow = z.object({
  id: z.uuid(), name: z.string(), slug: z.string(), country: z.string(), plan: Plan, status: Status, createdAt: z.iso.datetime(),
  members: z.number().int().describe("Active members"),
  connections: z.object({ total: z.number().int(), needsAttention: z.number().int() }),
  lastMonth: Usage.nullable().describe("The last closed month's usage; the open month needs the store's own data"),
});
export const StoresPageSchema = z.object({ data: z.array(StoreRow), total: z.number().int(), nextOffset: z.number().int().nullable() });

export const StoreDetailSchema = StoreRow.extend({
  currency: z.string(), timezone: z.string(), updatedAt: z.iso.datetime(),
  team: z.array(z.object({ userId: z.uuid(), email: z.string().nullable(), name: z.string().nullable(), role: z.string(), status: z.string(), joinedAt: z.iso.datetime() })),
  integrations: z.array(z.object({
    id: z.uuid(), kind: z.string(), provider: z.string(), account: z.string().nullable(), name: z.string().nullable(),
    status: z.string(), reason: z.string().nullable(), updatedAt: z.iso.datetime(),
  })),
  outbox: z.object({ pending: z.number().int(), running: z.number().int(), dead: z.number().int(), oldestPendingAt: z.iso.datetime().nullable() }),
  deadLetters: z.array(z.object({ id: z.string(), kind: z.string(), provider: z.string(), attempts: z.number().int(), error: z.string().nullable(), failedAt: z.iso.datetime() }))
    .describe("The latest 20; payloads stay with the store (replay from A-4 or the store's own screen)"),
  usage: z.array(Usage).describe("Closed months, newest first (up to 12)"),
  notes: z.array(z.object({ id: z.uuid(), body: z.string(), by: z.string().nullable(), at: z.iso.datetime() })).describe("Internal; the store never sees them"),
});

export const StoreStateSchema = z.object({ id: z.uuid(), plan: Plan, status: Status, updatedAt: z.iso.datetime() });
export const SuspendStoreSchema = z.strictObject({ reason: z.string().trim().min(3).max(500).describe("Shown to the store in its audit log") });
export const ReactivateStoreSchema = z.strictObject({ reason: z.string().trim().min(3).max(500).optional() });
export const ChangePlanSchema = z.strictObject({ plan: Plan, reason: z.string().trim().min(3).max(500).optional() });
export const AddNoteSchema = z.strictObject({ body: z.string().trim().min(1).max(2000) });
export const NoteSchema = z.object({ id: z.uuid(), body: z.string(), by: z.string().nullable(), at: z.iso.datetime() });
