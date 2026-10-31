import type { BadgeTone } from "@/components/ui/Badge";
import type { Schemas } from "@/lib/api/client";

export type TicketStatus = Schemas["Ticket"]["status"];
export const TICKET_TYPES = ["complaint", "exchange", "refund", "delivery_issue", "return", "refused"] as const satisfies ReadonlyArray<Schemas["Ticket"]["type"]>;
export const TICKET_STATUSES = ["open", "waiting_customer", "waiting_courier", "in_inspection", "resolved", "closed"] as const satisfies readonly TicketStatus[];
export const TICKET_REASONS = ["wrong_size", "wrong_item", "damaged", "missing_item", "not_as_described", "quality", "changed_mind", "late_delivery", "courier_behaviour", "not_delivered", "price", "other"] as const;
export const TICKET_SOURCES = ["team", "whatsapp", "phone", "courier", "automation"] as const;
export const STATUS_TONE: Record<TicketStatus, BadgeTone> = {
  open: "info", waiting_customer: "warning", waiting_courier: "warning", in_inspection: "info", resolved: "success", closed: "neutral",
};
/** Roles that open tickets; everyone with the menu item reads them. */
export const CREATE_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "ops_manager", "finance", "agent"]);
