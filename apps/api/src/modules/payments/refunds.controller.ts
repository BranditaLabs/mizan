import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import {
  CompleteRefundSchema, ListRefundsQuerySchema, NewRefundSchema, RefundListSchema, RefundOptionsSchema, RefundSchema, RejectRefundSchema,
  type CompleteRefund, type ListRefundsQuery, type NewRefund,
} from "./payments.dto.js";
import { RefundsService } from "./refunds.service.js";
import { RefundSettingsSchema, RefundSettingsViewSchema, type RefundSettings } from "./refunds.settings.js";

/** M15 refunds on an order (E14-4). */
@ApiTags("payments")
@Controller("orders/:id/refunds")
export class OrderRefundsController {
  constructor(@Inject(RefundsService) private readonly refunds: RefundsService) {}

  @Get("options")
  @Roles("owner", "admin", "ops_manager", "finance")
  @ApiJson(200, "RefundOptions", RefundOptionsSchema, "What can still go back on this order, where to, and the approval threshold")
  @ApiProblems(404)
  options(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.refunds.options(auth, id);
  }

  @Post()
  @HttpCode(201)
  @Roles("owner", "admin", "ops_manager", "finance")
  @ApiJsonBody("NewRefund", NewRefundSchema)
  @ApiJson(201, "Refund", RefundSchema, "Numbered R-1001…; approved at once under the store's threshold (store credit then completes); audited")
  @ApiProblems(404, 409, 422)
  request(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(NewRefundSchema)) body: NewRefund) {
    return this.refunds.request(auth, id, body);
  }
}

/** M15 refunds to approve and complete (E14-4). */
@ApiTags("payments")
@Controller("refunds")
export class RefundsController {
  constructor(@Inject(RefundsService) private readonly refunds: RefundsService) {}

  @Get()
  @Roles("owner", "admin", "ops_manager", "finance")
  @ApiQueryZod(ListRefundsQuerySchema)
  @ApiJson(200, "RefundList", RefundListSchema, "Newest first; open (default) is what still needs approving or sending")
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(ListRefundsQuerySchema)) q: ListRefundsQuery) {
    return this.refunds.list(auth, q);
  }

  @Post(":refundId/approve")
  @HttpCode(200)
  @Roles("owner", "admin", "finance")
  @ApiJson(200, "Refund", RefundSchema, "Approved; never by whoever asked unless the owner; store credit completes at once; audited")
  @ApiProblems(403, 404, 409)
  approve(@Auth() auth: AuthContext, @Param("refundId", new ParseUUIDPipe()) id: string) {
    return this.refunds.approve(auth, id);
  }

  @Post(":refundId/reject")
  @HttpCode(200)
  @Roles("owner", "admin", "finance")
  @ApiJsonBody("RejectRefund", RejectRefundSchema)
  @ApiJson(200, "Refund", RefundSchema, "Rejected with a reason; audited")
  @ApiProblems(404, 409)
  reject(@Auth() auth: AuthContext, @Param("refundId", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(RejectRefundSchema)) body: { reason: string }) {
    return this.refunds.reject(auth, id, body.reason);
  }

  @Post(":refundId/complete")
  @HttpCode(200)
  @Roles("owner", "admin", "finance")
  @ApiJsonBody("CompleteRefund", CompleteRefundSchema)
  @ApiJson(200, "Refund", RefundSchema, "The money went back (a transfer, cash, or a gateway refund on Mizan's own orders): a refund line in the ledger; audited")
  @ApiProblems(404, 409)
  complete(@Auth() auth: AuthContext, @Param("refundId", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(CompleteRefundSchema)) body: CompleteRefund) {
    return this.refunds.complete(auth, id, body);
  }
}

/** Settings → Refunds (E14-4): the amount over which a refund needs approval. */
@ApiTags("payments")
@Controller("settings/refunds")
export class RefundSettingsController {
  constructor(@Inject(RefundsService) private readonly refunds: RefundsService) {}

  @Get()
  @Roles("owner", "admin", "ops_manager", "finance")
  @ApiJson(200, "RefundSettingsView", RefundSettingsViewSchema, "Refunds above approveOver (base currency) need owner, admin or finance")
  get(@Auth() auth: AuthContext) {
    return this.refunds.getSettings(auth);
  }

  @Put()
  @Roles("owner", "admin")
  @ApiJsonBody("RefundSettings", RefundSettingsSchema)
  @ApiJson(200, "RefundSettingsView", RefundSettingsViewSchema, "Saved for refunds asked from now on; audited")
  @ApiProblems(422)
  put(@Auth() auth: AuthContext, @Body(new ZodPipe(RefundSettingsSchema)) body: RefundSettings) {
    return this.refunds.putSettings(auth, body);
  }
}
