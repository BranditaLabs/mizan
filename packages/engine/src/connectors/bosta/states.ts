import type { StatusMapperConfig } from "../../adapt/status.js";

/**
 * Bosta status vocabulary.
 *
 * Public sources disagree on Bosta's numeric state codes (Bosta's own SDKs
 * use different API versions: v0 with text states, v1, and v2 with numeric
 * codes, and third-party SDKs publish conflicting numbers). So the engine
 * deliberately ships with NO trusted numeric codes:
 *
 *   - Labels (Bosta's state text, from Bosta's official SDK) do the mapping.
 *   - When a code arrives together with a label, the code → status pair is
 *     learned and persisted (see LearningStatusMapper in the connector).
 *   - Terminal statuses (delivered, returned, cancelled, lost) are only
 *     trusted from a code after repeated consistent observations, or after
 *     ops confirms them.
 *
 * Fill `codes` from the API reference in your Bosta business account
 * (or with your account manager) to start fully trusted on day one.
 */
export const BOSTA_STATUS_CONFIG: StatusMapperConfig = {
  connector: "bosta",
  codes: {},
  labels: [
    // Terminal first, so "Delivery confirmed" never matches a "delivering" rule.
    { pattern: /^(delivered|delivery confirmed|تم التوصيل|تم التسليم)$/i, status: "delivered" },
    { pattern: /returned to (business|origin|shipper)|^returned$|مرتجع|تم الإرجاع/i, status: "returned" },
    { pattern: /^(canceled|cancelled|terminated)$|ملغي|تم الإلغاء/i, status: "cancelled" },
    { pattern: /^lost$|مفقود/i, status: "lost" },
    { pattern: /returning|return to (business|origin)|in return/i, status: "returning" },
    { pattern: /^(delivering|arrived at customer|out for delivery)$|خرج للتوصيل|جاري التوصيل/i, status: "out_for_delivery" },
    { pattern: /failed|not delivered|customer (not available|unreachable|refused)|refused|محاولة/i, status: "failed_attempt" },
    { pattern: /^(exception|investigation|damaged|on hold|awaiting (your )?action)$/i, status: "exception" },
    { pattern: /in transit|between hubs|في الطريق/i, status: "in_transit" },
    { pattern: /^(picked up|picked up from business|received at warehouse|fulfilled)$|تم الاستلام/i, status: "picked_up" },
    { pattern: /^(pickup requested|waiting for route|route assigned|waiting for pickup|picking up|picking up from warehouse|arrived at business)$/i, status: "pickup_requested" },
    { pattern: /^(created|new)$/i, status: "created" },
  ],
};
