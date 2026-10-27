import type { CanonicalOrder } from "@mizan/shared";
import type { ShipOutcome } from "@mizan/engine";

/**
 * Between the engine registry and M3 shipping (each would otherwise import the other): the engine
 * reads the order it ships and reports the courier's answer here. Only a symbol and a type.
 */
export const SHIPMENT_RESULTS = Symbol("SHIPMENT_RESULTS");
export interface ShipmentResultSink {
  loadOrder(tenantId: string, orderId: string): Promise<CanonicalOrder | undefined>;
  recordResult(tenantId: string, shipmentId: string, result: ShipOutcome): Promise<void>;
}
