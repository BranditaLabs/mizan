import { LIVE_MAX_TOPICS, type LiveEnd } from "@mizan/shared";
import { z } from "zod";

const Topic = z.string().describe("orders, shipments, confirmation, tickets, refunds, connections, notifications, or order:<uuid>");

export const LiveTokenRequestSchema = z.object({
  topics: z.array(z.string().min(1).max(60)).min(1).max(LIVE_MAX_TOPICS).describe("What the stream should carry; each needs the permission that reads the same data"),
}).strict();

export const LiveTokenSchema = z.object({
  token: z.string().describe("Single-use, for one GET /v1/live within expiresAt; bound to this store, this person and these topics"),
  expiresAt: z.string().describe("ISO time; a token not used by then is refused"),
  topics: z.array(Topic),
  url: z.string().describe("The path to open with EventSource (topics and token in the query string)"),
});

export const LiveQuerySchema = z.object({
  token: z.string().min(1).max(200).describe("From POST /v1/live/token"),
  topics: z.string().max(2000).optional().describe("Comma-separated; must be among the token's topics (default: all of them)"),
});

/** The wire shapes of `LiveReady` and `LiveChange` in @mizan/shared (topics as plain strings here). */
export const LiveReadySchema = z.object({
  topics: z.array(Topic),
  heartbeatMs: z.number().int().describe("A comment line arrives at least this often"),
  endsAt: z.string().describe("When the server ends the stream with `end` (reason expired)"),
});

export const LiveChangeSchema = z.object({
  id: z.string(),
  type: z.string().describe("A domain event type, notification.created, or resync (refetch every topic)"),
  topics: z.array(Topic),
  entity: z.object({ type: z.string(), id: z.string() }).nullable(),
  orderId: z.string().nullable(),
  at: z.string(),
});

export const LiveEndSchema = z.object({
  reason: z.enum(["expired", "revoked", "shutdown"]).describe("Mint a new token and reconnect"),
}) satisfies z.ZodType<LiveEnd>;
