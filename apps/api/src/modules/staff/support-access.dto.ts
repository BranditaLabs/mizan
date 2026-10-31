import { z } from "zod";

export const OpenAccessSchema = z.strictObject({
  reason: z.string().trim().min(3).max(500).describe("Why; shown to the store"),
  minutes: z.number().int().min(5).max(480).default(60).describe("Until it ends by itself (at most 8 hours)"),
  mode: z.enum(["read", "write"]).default("read").describe("write needs a super admin"),
});
const Grant = z.object({
  id: z.uuid(), storeId: z.uuid(), storeName: z.string(), mode: z.enum(["read", "write"]), reason: z.string(),
  startedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
});
export const GrantSchema = Grant;
export const GrantsSchema = z.object({ data: z.array(Grant) });
export const EndedSchema = z.object({ ended: z.number().int().describe("Grants ended") });

/** What the store sees: never who on the staff, only that Mizan support is in, why and until when. */
const StoreGrant = z.object({ id: z.uuid(), mode: z.enum(["read", "write"]), reason: z.string(), startedAt: z.iso.datetime(), expiresAt: z.iso.datetime() });
export const StoreGrantsSchema = z.object({ data: z.array(StoreGrant) });
