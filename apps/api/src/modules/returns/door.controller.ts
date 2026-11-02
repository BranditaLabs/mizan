import { Body, Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { PartialDeliveredSchema, PartialDeliverySchema, RefusalRecordedSchema, RefusalSchema, type PartialDeliveryBody, type RefusalBody } from "./door.dto.js";
import { DoorService } from "./door.service.js";

/** M6 what happened at the door (E10-4): a partial delivery, or a refusal with its reason. */
@ApiTags("returns")
@Controller("orders/:id")
export class DoorController {
  constructor(@Inject(DoorService) private readonly door: DoorService) {}

  @Post("partial-delivery")
  @HttpCode(200)
  @Roles("owner", "admin", "ops_manager", "warehouse")
  @ApiJsonBody("PartialDelivery", PartialDeliverySchema)
  @ApiJson(200, "PartialDelivered", PartialDeliveredSchema, "Delivered in part: what the customer owes now, the cash collected (in the ledger), any refund due, and what comes back; audited")
  @ApiProblems(404, 409, 422)
  partial(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(PartialDeliverySchema)) body: PartialDeliveryBody) {
    return this.door.partialDelivery(auth, id, body);
  }

  @Post("refusal")
  @HttpCode(200)
  @Roles("owner", "admin", "ops_manager", "agent", "warehouse")
  @ApiJsonBody("Refusal", RefusalSchema)
  @ApiJson(200, "RefusalRecorded", RefusalRecordedSchema, "Why the customer refused at the door, and whether they opened the box (a later call corrects it); audited")
  @ApiProblems(404, 409, 422)
  refusal(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(RefusalSchema)) body: RefusalBody) {
    return this.door.refusal(auth, id, body);
  }
}
