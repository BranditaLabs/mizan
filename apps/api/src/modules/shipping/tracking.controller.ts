import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Auth, Can } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { ImportStatusesSchema, ListShipmentsQuerySchema, SetStatusSchema, StatusesImportedSchema, ShipmentHistorySchema, ShipmentPageSchema, type ListShipmentsQuery, type SetStatusBody } from "./tracking.dto.js";
import { ShippingService } from "./shipping.service.js";
import { TrackingService } from "./tracking.service.js";

const StatusSetSchema = z.object({ id: z.uuid(), status: z.string() });
const CourierCancelSchema = z.object({ queued: z.boolean().describe("false when it was asked already") });

/** M3 tracking (E7-3): shipments with the courier, the needs-review queue, and a person's override. */
@ApiTags("shipping")
@Controller("shipments")
export class TrackingController {
  constructor(@Inject(TrackingService) private readonly tracking: TrackingService, @Inject(ShippingService) private readonly shipping: ShippingService) {}

  @Get()
  @Can("shipments.read")
  @ApiQueryZod(ListShipmentsQuerySchema)
  @ApiJson(200, "ShipmentPage", ShipmentPageSchema, "Shipments newest first in a view, with counts per view; the area, never the address")
  @ApiProblems(422)
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(ListShipmentsQuerySchema)) q: ListShipmentsQuery) {
    return this.tracking.list(auth, q);
  }

  @Post("statuses/import")
  @HttpCode(200)
  @Can("shipments.manage")
  @ApiJsonBody("ImportShipmentStatuses", ImportStatusesSchema)
  @ApiJson(200, "ShipmentStatusesImported", StatusesImportedSchema, "Every row applied as a person's update (audited); any bad line or unknown tracking number: 422 csv_invalid naming each line, nothing saved")
  @ApiProblems(422)
  importStatuses(@Auth() auth: AuthContext, @Body(new ZodPipe(ImportStatusesSchema)) body: z.output<typeof ImportStatusesSchema>) {
    return this.tracking.importStatuses(auth, body.csv);
  }

  @Get(":id/events")
  @Can("shipments.read")
  @ApiJson(200, "ShipmentHistory", ShipmentHistorySchema, "Every status the shipment had, newest first: from a webhook, a poll, or a person")
  @ApiProblems(404)
  history(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.tracking.history(auth.tenant!.id, id);
  }

  @Post(":id/status")
  @HttpCode(200)
  @Can("shipments.manage")
  @ApiJsonBody("SetShipmentStatus", SetStatusSchema)
  @ApiJson(200, "ShipmentStatusSet", StatusSetSchema, "Set by a person (rule 7: the override for a status Mizan could not map, or a final one); audited")
  @ApiProblems(404, 409, 422)
  setStatus(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(SetStatusSchema)) body: SetStatusBody) {
    return this.tracking.setStatus(auth, id, body);
  }

  /** Cancel a booked delivery at the courier (Bosta: terminate); the shipment is cancelled when Bosta confirms. */
  @Post(":id/cancel")
  @HttpCode(202)
  @Can("shipments.manage")
  @ApiJson(202, "CourierCancelQueued", CourierCancelSchema, "Queued once; audited. Bosta refuses a parcel already picked up: the shipment then waits in review with why")
  @ApiProblems(404, 409)
  cancel(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.shipping.cancelAtCourier(auth, id);
  }
}
