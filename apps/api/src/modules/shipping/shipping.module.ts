import { Global, Module } from "@nestjs/common";
import { ORDER_SHIPPING } from "../orders/ports.js";
import { SHIPMENT_RESULTS } from "./ports.js";
import { ScorecardController } from "./scorecard.controller.js";
import { ScorecardService } from "./scorecard.service.js";
import { ShippingController } from "./shipping.controller.js";
import { ShippingService } from "./shipping.service.js";
import { TrackingController } from "./tracking.controller.js";
import { TrackingService } from "./tracking.service.js";

/** M3 shipping: booking the courier (E7-1), tracking and the review queue (E7-3), bulk ship (E7-2). Global: bulk actions book through ORDER_SHIPPING. */
@Global()
@Module({ controllers: [ShippingController, TrackingController, ScorecardController], providers: [ShippingService, TrackingService, ScorecardService, { provide: SHIPMENT_RESULTS, useExisting: ShippingService }, { provide: ORDER_SHIPPING, useExisting: ShippingService }], exports: [ShippingService, SHIPMENT_RESULTS, ORDER_SHIPPING] })
export class ShippingModule {}
