import { Module } from "@nestjs/common";
import { SHIPMENT_RESULTS } from "./ports.js";
import { ScorecardController } from "./scorecard.controller.js";
import { ScorecardService } from "./scorecard.service.js";
import { ShippingController } from "./shipping.controller.js";
import { ShippingService } from "./shipping.service.js";
import { TrackingController } from "./tracking.controller.js";
import { TrackingService } from "./tracking.service.js";

/** M3 shipping: booking the courier (E7-1), tracking and the review queue (E7-3); labels and the shipping screen follow (E7-2). */
@Module({ controllers: [ShippingController, TrackingController, ScorecardController], providers: [ShippingService, TrackingService, ScorecardService, { provide: SHIPMENT_RESULTS, useExisting: ShippingService }], exports: [ShippingService, SHIPMENT_RESULTS] })
export class ShippingModule {}
