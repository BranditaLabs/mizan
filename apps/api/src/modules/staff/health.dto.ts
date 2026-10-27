import { z } from "zod";

const Circuit = z.object({ provider: z.enum(["shopify", "bosta"]), open: z.number().int(), halfOpen: z.number().int(), closed: z.number().int() });
export const SystemHealthSchema = z.object({
  at: z.iso.datetime(),
  outbox: z.object({
    pending: z.number().int(), running: z.number().int(), dead: z.number().int(),
    oldestDueSeconds: z.number().describe("mizan_outbox_oldest_due_seconds"),
  }).describe("mizan_outbox_jobs, every store"),
  events: z.object({ pending: z.number().int(), dead: z.number().int(), oldestPendingSeconds: z.number() }).describe("mizan_domain_events"),
  deadEvents: z.array(z.object({ type: z.string(), count: z.number().int() })).describe("Dead domain events by type, most first"),
  circuits: z.array(Circuit).describe("mizan_engine_circuits_open: store engines built on this API instance"),
  stores: z.array(z.object({
    storeId: z.uuid(), storeName: z.string(), pending: z.number().int(), running: z.number().int(), dead: z.number().int(), oldestDueSeconds: z.number(),
  })).describe("Stores with the most jobs waiting or dead (up to 20)"),
  drift: z.array(z.object({
    connector: z.string(), entity: z.string(), kind: z.string(), field: z.string().nullable(), detail: z.string(),
    count: z.number().int(), stores: z.number().int(), lastAt: z.iso.datetime(),
  })).describe("Provider fields and statuses that changed shape, across this instance's engines, most frequent first (no samples)"),
  db: z.object({
    pool: z.object({ total: z.number().int(), idle: z.number().int(), waiting: z.number().int() }).nullable().describe("mizan_db_pool_connections"),
    sizeBytes: z.number().nullable(), connections: z.number().int().nullable(),
  }),
  process: z.object({ uptimeSeconds: z.number(), rssBytes: z.number(), heapUsedBytes: z.number() }),
});

export const DeadLettersQuerySchema = z.object({
  storeId: z.uuid().optional(),
  kind: z.string().regex(/^[a-zA-Z0-9_.]+$/).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const PlatformDeadLettersSchema = z.object({
  data: z.array(z.object({
    id: z.uuid(), storeId: z.uuid(), storeName: z.string(), kind: z.string(), provider: z.string(), attempts: z.number().int(),
    error: z.string().nullable(), failedAt: z.iso.datetime(),
  })).describe("Newest first; payloads stay with the store"),
});
export const ReplayedSchema = z.object({ replayed: z.literal(true), storeId: z.uuid() });
