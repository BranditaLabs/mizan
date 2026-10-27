import { Module } from "@nestjs/common";
import { SHIPMENT_RESULTS } from "./ports.js";
import { ShippingController } from "./shipping.controller.js";
import { ShippingService } from "./shipping.service.js";

/** M3 shipping: booking the courier (E7-1); tracking, labels and the shipping screen follow (E7-2, E7-3). */
@Module({ controllers: [ShippingController], providers: [ShippingService, { provide: SHIPMENT_RESULTS, useExisting: ShippingService }], exports: [ShippingService, SHIPMENT_RESULTS] })
export class ShippingModule {}
