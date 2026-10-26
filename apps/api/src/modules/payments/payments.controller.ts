import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { LedgerService } from "./ledger.service.js";
import { LedgerSchema, RecordPaymentSchema, type RecordPayment } from "./payments.dto.js";

/** M15 (E14-1): an order's payment ledger. */
@ApiTags("payments")
@Controller("orders/:id/payments")
export class PaymentsController {
  constructor(@Inject(LedgerService) private readonly ledger: LedgerService) {}

  @Get()
  @Roles("owner", "admin", "ops_manager", "finance")
  @ApiJson(200, "Ledger", LedgerSchema, "Every money movement on the order, newest first, and its totals")
  @ApiProblems(404)
  get(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.ledger.get(auth, id);
  }

  /** Money the team received or gave back outside any gateway; the order's totals follow in the same transaction. */
  @Post()
  @HttpCode(201)
  @Roles("owner", "admin", "finance")
  @ApiJsonBody("RecordPayment", RecordPaymentSchema)
  @ApiJson(201, "Ledger", LedgerSchema, "Recorded and audited; the ledger as it is now")
  @ApiProblems(404, 409, 422)
  record(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(RecordPaymentSchema)) body: RecordPayment) {
    return this.ledger.record(auth, id, body);
  }
}
