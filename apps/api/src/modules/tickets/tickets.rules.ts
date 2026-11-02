/**
 * Tickets (M6, E10-1): the fixed lists and the status rules, free of the database.
 * A ticket moves freely between its working statuses; resolved can be reopened; closed is final.
 */
export const TICKET_TYPES = ["complaint", "exchange", "refund", "delivery_issue", "return", "refused"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];
export const TICKET_STATUSES = ["open", "waiting_customer", "waiting_courier", "in_inspection", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
/** Fixed reason codes, so returns can be reported by product (docs/modules/M06). */
export const TICKET_REASONS = ["wrong_size", "wrong_item", "damaged", "missing_item", "not_as_described", "quality", "changed_mind", "late_delivery", "courier_behaviour", "not_delivered", "price", "other"] as const;
export type TicketReason = (typeof TICKET_REASONS)[number];
export const TICKET_SOURCES = ["team", "whatsapp", "phone", "courier", "automation"] as const;

/** Filters on the list: each status group, or every ticket still being worked on. */
export const TICKET_VIEWS = ["active", "open", "waiting", "inspection", "resolved", "closed", "late", "all"] as const;
export type TicketView = (typeof TICKET_VIEWS)[number];
export const VIEW_STATUSES: Record<Exclude<TicketView, "late" | "all">, TicketStatus[]> = {
  active: ["open", "waiting_customer", "waiting_courier", "in_inspection"],
  open: ["open"],
  waiting: ["waiting_customer", "waiting_courier"],
  inspection: ["in_inspection"],
  resolved: ["resolved"],
  closed: ["closed"],
};
export const DONE: ReadonlySet<string> = new Set(["resolved", "closed"]);

/** Hours a ticket has before it is late (the M6 default SLA; per-store setting later). */
export const SLA_HOURS = 24;

/** null if the move is allowed (or a no-op); otherwise why not. */
export function moveRefusal(from: TicketStatus, to: TicketStatus): "ticket_closed" | null {
  if (from === to) return null;
  return from === "closed" ? "ticket_closed" : null;
}

/** Timestamps a move sets: resolving stamps resolved_at, reopening clears it, closing stamps closed_at. */
export function stamps(from: TicketStatus, to: TicketStatus, now: Date): { resolved_at?: Date | null; closed_at?: Date | null } {
  if (from === to) return {};
  if (to === "resolved") return { resolved_at: now };
  if (to === "closed") return { closed_at: now, ...(from === "resolved" ? {} : { resolved_at: now }) };
  if (from === "resolved") return { resolved_at: null };
  return {};
}

export const isLate = (status: string, dueAt: Date | null, now: Date) => !DONE.has(status) && dueAt !== null && dueAt.getTime() < now.getTime();
