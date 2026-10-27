import { Body, Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { HttpReply as Response } from "../../platform/http/http.types.js";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { ManualShipmentSchema } from "./tracking.dto.js";
import type { z } from "zod";
import { ShipmentSchema } from "./shipping.dto.js";
import { ShippingService } from "./shipping.service.js";

/** M3 shipping (E7-1): hand a confirmed order to the courier. */
@ApiTags("shipping")
@Controller("orders/:id/ship")
export class ShippingController {
  constructor(@Inject(ShippingService) private readonly shipping: ShippingService) {}

  @Post()
  @HttpCode(202)
  @Roles("owner", "admin", "ops_manager", "warehouse")
  @ApiJson(202, "Shipment", ShipmentSchema, "Booking queued (booking = pending), or the booking already pending or booked for this order (200); audited")
  @ApiProblems(404, 409)
  async ship(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Res({ passthrough: true }) res: Response) {
    const r = await this.shipping.ship(auth, id);
    if (!r.created) void res.code(200);
    return r.shipment;
  }

  @Post("manual")
  @Roles("owner", "admin", "ops_manager", "warehouse")
  @ApiJsonBody("ManualShipment", ManualShipmentSchema)
  @ApiJson(201, "Shipment", ShipmentSchema, "E7-6: a courier without an API — the parcel handed over, recorded with its tracking number; the order is shipped; audited")
  @ApiProblems(404, 409, 422)
  manual(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(ManualShipmentSchema)) body: z.output<typeof ManualShipmentSchema>) {
    return this.shipping.shipManual(auth, id, body);
  }
}
