import { z } from "zod";

/** What Mizan writes back to a Shopify store as the courier reports (E7-7). Every switch is on by default. */
export const StoreSyncSchema = z.object({
  progressEvents: z.boolean().describe("Courier steps as Shopify fulfillment events: picked up, in transit, out for delivery, attempts, delivered, failures"),
  markPaidOnDelivery: z.boolean().describe("Mark cash-on-delivery orders paid in Shopify when delivered"),
  tagReturned: z.boolean().describe("Tag mizan-returned when the parcel is back"),
  tagLost: z.boolean().describe("Tag mizan-lost when the courier lost it"),
});
export type StoreSync = z.infer<typeof StoreSyncSchema>;
export const PutStoreSyncSchema = StoreSyncSchema.partial().strict().refine((b) => Object.keys(b).length > 0, "change at least one switch");

export const DEFAULT_SYNC: StoreSync = { progressEvents: true, markPaidOnDelivery: true, tagReturned: true, tagLost: true };

/** The switches as stored in connections.config.sync (unknown or missing values fall back to on). */
export function storeSyncOf(config: Record<string, unknown> | null | undefined): StoreSync {
  const raw = (config?.sync ?? {}) as Partial<Record<keyof StoreSync, unknown>>;
  return Object.fromEntries(Object.entries(DEFAULT_SYNC).map(([k, d]) => [k, typeof raw[k as keyof StoreSync] === "boolean" ? raw[k as keyof StoreSync] : d])) as StoreSync;
}

/** EngineOptions for the switches. */
export const engineSyncOptions = (s: StoreSync) => ({
  fulfillmentEvents: s.progressEvents,
  markCodPaidOnDelivery: s.markPaidOnDelivery,
  tagOnReturn: s.tagReturned ? "mizan-returned" : null,
  tagOnLost: s.tagLost ? "mizan-lost" : null,
});
