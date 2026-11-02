import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { LedgerService } from "./ledger.service.js";
import { LedgerSchema, ListPaymentsQuerySchema, PaymentMixQuerySchema, PaymentMixSchema, PaymentPageSchema, RecordPaymentSchema, type ListPaymentsQuery, type RecordPayment } from "./payments.dto.js";
import { PaymentsListService } from "./payments-list.service.js";

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

/** M15 payments screen (E14-6): orders by where their money stands, and the payment mix. */
@ApiTags("payments")
@Controller("payments")
export class PaymentsListController {
  constructor(@Inject(PaymentsListService) private readonly payments: PaymentsListService) {}

  @Get()
  @Roles("owner", "admin", "ops_manager", "finance")
  @ApiQueryZod(ListPaymentsQuerySchema)
  @ApiJson(200, "PaymentPage", PaymentPageSchema, "Newest first, with counts per view and the view's sums per currency")
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(ListPaymentsQuerySchema)) q: ListPaymentsQuery) {
    return this.payments.list(auth, q);
  }

  @Get("mix")
  @Roles("owner", "admin", "ops_manager", "finance")
  @ApiQueryZod(PaymentMixQuerySchema)
  @ApiJson(200, "PaymentMix", PaymentMixSchema, "Orders by payment mode and money in by method over the last 7, 30 or 90 days")
  mix(@Auth() auth: AuthContext, @Query(new ZodPipe(PaymentMixQuerySchema)) q: { days: number }) {
    return this.payments.mix(auth, q.days);
  }
}
