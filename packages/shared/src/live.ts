import type { DomainEventType } from "./events.js";
import type { Permission } from "./permissions.js";

/**
 * Live updates (LV-1, docs/16 §4.0): the dashboard opens one Server-Sent Events stream
 * (`GET /v1/live`) and refetches what a change touches. A change carries ids and the event type
 * only, never the record: the screen reads the record through the usual API, under its own checks.
 */
export const LIVE_TOPICS = ["orders", "shipments", "confirmation", "tickets", "refunds", "connections", "notifications"] as const;
export type LiveTopicName = (typeof LIVE_TOPICS)[number];
/** A named topic, or one order's changes (`order:<uuid>`). */
export type LiveTopic = LiveTopicName | `order:${string}`;

/** At most this many topics on one stream. */
export const LIVE_MAX_TOPICS = 12;

/** Who may listen to a topic: the permission that reads the same data (`null`: every member). */
export const LIVE_TOPIC_PERMISSION: Record<LiveTopicName | "order", Permission | null> = {
  orders: "orders.read",
  order: "orders.read",
  shipments: "shipments.read",
  confirmation: "confirmation.work",
  tickets: "tickets.read",
  refunds: "refunds.read",
  connections: "connections.read",
  notifications: null,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A topic as sent by a client, or null when it is not one. Order ids are lower-cased. */
export function parseLiveTopic(raw: string): LiveTopic | null {
  const t = raw.trim();
  if ((LIVE_TOPICS as readonly string[]).includes(t)) return t as LiveTopicName;
  if (t.startsWith("order:") && UUID.test(t.slice(6))) return `order:${t.slice(6).toLowerCase()}`;
  return null;
}

/** The permission a topic needs (`null`: any member). */
export function liveTopicPermission(topic: LiveTopic): Permission | null {
  return topic.startsWith("order:") ? LIVE_TOPIC_PERMISSION.order : LIVE_TOPIC_PERMISSION[topic as LiveTopicName];
}

const CONFIRMATION_TYPES = new Set<string>(["order.scored", "order.confirmed", "order.confirmation_failed", "order.ready_to_ship", "order.auto_ship_blocked"]);

/** The shape of a domain event the live feed looks at (no data beyond an order id). */
export interface LiveSource {
  type: string;
  entity: { type: string; id: string };
  /** The order the event is about when its entity is something else (a shipment, a ticket). */
  orderId?: string | null;
}

/**
 * Which topics a domain event feeds (the `notifications` topic is fed by the bell's own rows).
 * Unknown event types feed only the topics their entity names.
 */
export function liveTopicsFor(event: LiveSource): LiveTopic[] {
  const out = new Set<LiveTopic>();
  const { type, entity } = event;
  const prefix = type.slice(0, type.indexOf(".") + 1);
  const orderId = entity.type === "order" ? entity.id : event.orderId ?? null;
  if (entity.type === "order" || prefix === "order." || prefix === "orders.") out.add("orders");
  if (orderId && UUID.test(orderId)) out.add(`order:${orderId.toLowerCase()}`);
  if (prefix === "shipment." || entity.type === "shipment") out.add("shipments");
  if (prefix === "confirmation." || prefix === "offer." || CONFIRMATION_TYPES.has(type)) out.add("confirmation");
  if (prefix === "ticket." || prefix === "conversation." || entity.type === "ticket") out.add("tickets");
  if (prefix === "refund." || entity.type === "refund") out.add("refunds");
  if (prefix === "connection." || type === "sync.recovered" || entity.type === "connection") out.add("connections");
  return [...out];
}

/** SSE event names on the stream. */
export const LIVE_SSE_EVENTS = { ready: "ready", change: "change", end: "end" } as const;

/** `event: ready`: the stream is open. */
export interface LiveReady {
  topics: LiveTopic[];
  /** A comment line arrives at least this often; silence for twice as long means the stream is dead. */
  heartbeatMs: number;
  /** When the server ends the stream (`end` with reason `expired`); reconnect with a new token. */
  endsAt: string;
}

/** `event: change`: something under these topics changed; refetch them. */
export interface LiveChange {
  /** The domain event or notification id (also the SSE `id:`). */
  id: string;
  /** The domain event type, `notification.created` for the bell, or `resync` (too many at once: refetch every topic). */
  type: DomainEventType | "notification.created" | "resync";
  /** The stream's topics this change falls under. */
  topics: LiveTopic[];
  entity: { type: string; id: string } | null;
  /** The order it is about, when known. */
  orderId: string | null;
  at: string;
}

/** Why the server ended a stream. Every reason means: mint a new token and reconnect (`revoked`: only after a fresh sign-in check). */
export type LiveEndReason = "expired" | "revoked" | "shutdown";

/** `event: end`: the server is closing the stream. */
export interface LiveEnd {
  reason: LiveEndReason;
}
