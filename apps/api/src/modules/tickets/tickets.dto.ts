import { z } from "zod";
import { TICKET_REASONS, TICKET_SOURCES, TICKET_STATUSES, TICKET_TYPES, TICKET_VIEWS } from "./tickets.rules.js";

const Text = (max: number) => z.string().trim().min(1).max(max);

export const NewTicketSchema = z.object({
  type: z.enum(TICKET_TYPES),
  reason: z.enum(TICKET_REASONS).optional(),
  orderId: z.uuid().optional().describe("The order it is about"),
  orderNumber: Text(40).optional().describe("Or the order's number as the team sees it (#1042, M-1001)"),
  description: Text(2000).optional().describe("What happened, in the team's words"),
  source: z.enum(TICKET_SOURCES).default("team").describe("Where the case came from"),
  assignedTo: z.uuid().optional(),
}).strict().refine((b) => !(b.orderId && b.orderNumber), { message: "give orderId or orderNumber, not both", path: ["orderNumber"] });
export type NewTicket = z.output<typeof NewTicketSchema>;

export const UpdateTicketSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  type: z.enum(TICKET_TYPES).optional(),
  reason: z.enum(TICKET_REASONS).nullable().optional(),
  assignedTo: z.uuid().nullable().optional().describe("null to unassign"),
  note: Text(2000).optional().describe("A note on the ticket's history"),
}).strict().refine((b) => Object.values(b).some((v) => v !== undefined), { message: "nothing to change" });
export type UpdateTicket = z.output<typeof UpdateTicketSchema>;

export const ListTicketsQuerySchema = z.object({
  view: z.enum(TICKET_VIEWS).default("active").describe("active: still being worked on (default); late: past their deadline; all"),
  type: z.enum(TICKET_TYPES).optional(),
  orderId: z.uuid().optional(),
  mine: z.enum(["true", "false"]).transform((v) => v === "true").optional().describe("Only tickets assigned to the caller"),
  q: z.string().trim().min(1).max(40).optional().describe("Ticket number (T-1001, 1001) or the order's number"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});
export type ListTicketsQuery = z.output<typeof ListTicketsQuerySchema>;

const Person = z.object({ id: z.uuid(), name: z.string().nullable() });
const OrderRef = z.object({ id: z.uuid(), number: z.string(), status: z.string() });

export const TicketSummarySchema = z.object({
  id: z.uuid(),
  number: z.string().describe("T-1001"),
  type: z.enum(TICKET_TYPES),
  reason: z.enum(TICKET_REASONS).nullable(),
  status: z.enum(TICKET_STATUSES),
  source: z.enum(TICKET_SOURCES),
  order: OrderRef.nullable(),
  assignee: Person.nullable(),
  dueAt: z.iso.datetime().nullable(),
  late: z.boolean().describe("Still open past its deadline"),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const TicketPageSchema = z.object({
  data: z.array(TicketSummarySchema),
  counts: z.object({ active: z.number().int(), open: z.number().int(), waiting: z.number().int(), inspection: z.number().int(), resolved: z.number().int(), closed: z.number().int(), late: z.number().int() }),
  nextCursor: z.string().nullable(),
});

export const TicketSchema = TicketSummarySchema.extend({
  description: z.string().nullable(),
  createdBy: Person.nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  canEdit: z.boolean().describe("Whether the caller may change status, type, reason and assignee (anyone who sees it may add a note)"),
  assignees: z.array(Person.extend({ role: z.string() })).describe("Who the caller may assign it to"),
  history: z.array(z.object({
    id: z.uuid(),
    type: z.enum(["created", "status", "assigned", "updated", "note", "refund"]),
    at: z.iso.datetime(),
    actor: Person.nullable(),
    data: z.record(z.string(), z.unknown()).describe("status: from, to; assigned: to; updated: changed fields"),
    note: z.string().nullable(),
  })),
});
export type Ticket = z.output<typeof TicketSchema>;
