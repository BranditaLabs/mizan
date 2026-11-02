import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { ListTicketsQuerySchema, NewTicketSchema, TicketPageSchema, TicketSchema, UpdateTicketSchema, type ListTicketsQuery, type NewTicket, type UpdateTicket } from "./tickets.dto.js";
import { TicketsService } from "./tickets.service.js";

/** M6 tickets (E10-1): complaints, exchanges, refunds, delivery issues, returns, refusals at the door. */
@ApiTags("tickets")
@Controller("tickets")
export class TicketsController {
  constructor(@Inject(TicketsService) private readonly tickets: TicketsService) {}

  @Get()
  @Roles("owner", "admin", "ops_manager", "finance", "agent", "warehouse")
  @ApiQueryZod(ListTicketsQuerySchema)
  @ApiJson(200, "TicketPage", TicketPageSchema, "Newest first, with counts per status group; agents see theirs, those they opened and the unassigned queue")
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(ListTicketsQuerySchema)) q: ListTicketsQuery) {
    return this.tickets.list(auth, q);
  }

  @Post()
  @HttpCode(201)
  @Roles("owner", "admin", "ops_manager", "finance", "agent")
  @ApiJsonBody("NewTicket", NewTicketSchema)
  @ApiJson(201, "Ticket", TicketSchema, "Numbered T-1001, T-1002… per store; due in 24 hours; an agent's ticket is assigned to them; audited")
  @ApiProblems(403, 409, 422)
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(NewTicketSchema)) body: NewTicket) {
    return this.tickets.create(auth, body);
  }

  @Get(":id")
  @Roles("owner", "admin", "ops_manager", "finance", "agent", "warehouse")
  @ApiJson(200, "Ticket", TicketSchema, "The ticket, its order and its history (newest first)")
  @ApiProblems(404)
  get(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.tickets.get(auth, id);
  }

  @Patch(":id")
  @Roles("owner", "admin", "ops_manager", "finance", "agent", "warehouse")
  @ApiJsonBody("UpdateTicket", UpdateTicketSchema)
  @ApiJson(200, "Ticket", TicketSchema, "Status, type, reason, assignee and a note; warehouse adds notes only; a closed ticket only takes notes; audited")
  @ApiProblems(403, 404, 409, 422)
  update(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(UpdateTicketSchema)) body: UpdateTicket) {
    return this.tickets.update(auth, id, body);
  }
}
