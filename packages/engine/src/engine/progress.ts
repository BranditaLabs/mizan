import type { ShipmentStatus } from "@mizan/shared";
import type { FulfillmentEventStatus } from "../connectors/shopify/connector.js";

/**
 * Courier progress as Shopify fulfillment events (E7-7): what the customer sees on their order
 * page and in Shopify's shipping emails. Statuses before pickup (the fulfillment itself says
 * "shipped"), cancelled and unknown ones send nothing. A refusal comes back as `returning`, a
 * lost parcel as `lost`: both are failures, with a line that says which.
 */
export function fulfillmentEventFor(status: ShipmentStatus): { status: FulfillmentEventStatus; message?: string } | null {
  switch (status) {
    case "picked_up": return { status: "CARRIER_PICKED_UP" };
    case "in_transit": return { status: "IN_TRANSIT" };
    case "out_for_delivery": return { status: "OUT_FOR_DELIVERY" };
    case "failed_attempt": return { status: "ATTEMPTED_DELIVERY" };
    case "delivered": return { status: "DELIVERED" };
    case "exception": return { status: "DELAYED" };
    case "returning": return { status: "FAILURE", message: "Not delivered: returning to the store" };
    case "lost": return { status: "FAILURE", message: "Lost by the courier" };
    default: return null;
  }
}
