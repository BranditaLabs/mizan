/**
 * Domain event catalogue (docs/03 §5) and envelope.
 * Events carry ids and business facts only — never personal data (names,
 * phones, addresses): consumers that need them read the entity.
 */
export const DOMAIN_EVENT_TYPES = [
  // Platform
  "tenant.created",
  "member.invited", "member.joined", "member.updated", "member.removed",
  "connection.connected", "connection.disconnected", "connection.needs_attention",
  "privacy.requested", "privacy.completed",
  // M1 Orders
  "order.created", "order.updated", "order.cancelled", "order.duplicate_found",
  // M2 Confirmation
  "order.scored", "order.confirmed", "order.confirmation_failed",
  // M3 Shipping
  "shipment.created", "shipment.status_changed", "shipment.delivered", "shipment.returned",
  // M4 Warehouse
  "stock.reserved", "stock.low", "stock.adjusted",
  // M5 Profit, M6 Returns, M8 Reconciliation
  "pnl.recomputed", "costs.changed", "fx.rate_overridden", "return.inspected", "settlement.matched", "settlement.gap_found",
  // M15 Payments
  "payment.received", "payment.failed", "refund.completed", "dispute.opened",
  "order.awaiting_payment", "order.payment_changed",
  // M16–M20
  "po.received", "stock.reorder_suggested", "conversation.created", "conversation.sla_breached",
  "channel.order_received", "listing.error", "channel.payout_received",
  "period.closed", "einvoice.rejected", "metric.threshold_crossed",
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export interface EventActor {
  type: "user" | "api_key" | "system" | "engine";
  id?: string;
}

/** The envelope consumers receive (docs/03 §5). Consumers must be idempotent by `id`. */
export interface DomainEvent<D = Record<string, unknown>> {
  id: string;
  type: DomainEventType;
  tenantId: string;
  occurredAt: string;
  actor: EventActor | null;
  entity: { type: string; id: string };
  data: D;
  version: number;
}

export function isDomainEventType(value: string): value is DomainEventType {
  return (DOMAIN_EVENT_TYPES as readonly string[]).includes(value);
}

/** Does a subscription pattern ("order.created", "order.*", "*") match an event type? */
export function matchesEvent(pattern: string, type: string): boolean {
  if (pattern === "*" || pattern === type) return true;
  return pattern.endsWith(".*") && type.startsWith(pattern.slice(0, -1));
}
