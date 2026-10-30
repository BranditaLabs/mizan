import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import {
  CloseDisputeSchema, DisputeListSchema, DisputeSchema, EvidencePackSchema, ListDisputesQuerySchema, NewDisputeSchema, SubmitEvidenceSchema,
  type CloseDispute, type ListDisputesQuery, type NewDispute,
} from "./disputes.dto.js";
import { DisputesService } from "./disputes.service.js";

/** M15 chargebacks on an order (E14-5). */
@ApiTags("payments")
@Controller("orders/:id/disputes")
export class OrderDisputesController {
  constructor(@Inject(DisputesService) private readonly disputes: DisputesService) {}

  @Post()
  @HttpCode(201)
  @Roles("owner", "admin", "finance")
  @ApiJsonBody("NewDispute", NewDisputeSchema)
  @ApiJson(201, "Dispute", DisputeSchema, "Numbered D-1001…; the amount leaves the ledger as a chargeback with its fee; the same case again returns it; audited")
  @ApiProblems(404, 409, 422)
  open(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(NewDisputeSchema)) body: NewDispute) {
    return this.disputes.open(auth, id, body);
  }
}

/** M15 disputes to answer and close (E14-5). */
@ApiTags("payments")
@Controller("disputes")
export class DisputesController {
  constructor(@Inject(DisputesService) private readonly disputes: DisputesService) {}

  @Get()
  @Roles("owner", "admin", "ops_manager", "finance")
  @ApiQueryZod(ListDisputesQuerySchema)
  @ApiJson(200, "DisputeList", DisputeListSchema, "The nearest deadline first, then the newest")
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(ListDisputesQuerySchema)) q: ListDisputesQuery) {
    return this.disputes.list(auth, q);
  }

  @Get(":disputeId")
  @Roles("owner", "admin", "ops_manager", "finance")
  @ApiJson(200, "Dispute", DisputeSchema, "One dispute")
  @ApiProblems(404)
  get(@Auth() auth: AuthContext, @Param("disputeId", new ParseUUIDPipe()) id: string) {
    return this.disputes.get(auth, id);
  }

  @Get(":disputeId/evidence")
  @Roles("owner", "admin", "finance")
  @ApiJson(200, "EvidencePack", EvidencePackSchema, "The order, delivery, chat actions and payments to send the gateway; the customer's name and address are decrypted and the access audited")
  @ApiProblems(404)
  evidence(@Auth() auth: AuthContext, @Param("disputeId", new ParseUUIDPipe()) id: string) {
    return this.disputes.evidence(auth, id);
  }

  @Post(":disputeId/evidence")
  @HttpCode(200)
  @Roles("owner", "admin", "finance")
  @ApiJsonBody("SubmitEvidence", SubmitEvidenceSchema)
  @ApiJson(200, "Dispute", DisputeSchema, "Marks the evidence sent to the gateway; audited")
  @ApiProblems(404, 409)
  submit(@Auth() auth: AuthContext, @Param("disputeId", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(SubmitEvidenceSchema)) body: { note?: string }) {
    return this.disputes.submitEvidence(auth, id, body.note);
  }

  @Post(":disputeId/close")
  @HttpCode(200)
  @Roles("owner", "admin", "finance")
  @ApiJsonBody("CloseDispute", CloseDisputeSchema)
  @ApiJson(200, "Dispute", DisputeSchema, "won puts the amount back in the ledger (the fee stays a cost); lost or accepted closes it; audited")
  @ApiProblems(404, 409)
  close(@Auth() auth: AuthContext, @Param("disputeId", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(CloseDisputeSchema)) body: CloseDispute) {
    return this.disputes.close(auth, id, body);
  }
}
