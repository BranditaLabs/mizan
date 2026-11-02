/**
 * Routing by payment method and risk band (M2, E6-2): what happens to a new order once it is
 * scored (E6-1). Cash orders: a trusted customer is confirmed without being asked (auto), most
 * are asked in the chat (bot: the store's cascade), risky ones go straight to the team's calls
 * (agent), the riskiest wait for a person to review them (hold). Paid orders are approved unless
 * very risky (then reviewed); BNPL is approved (the provider carries the risk); an unpaid bank
 * transfer waits for its money. Off by default: every cash order then walks the cascade as before.
 */
export type Route = "auto" | "bot" | "agent" | "hold";

export interface RoutingSettings {
  enabled: boolean;
  /** Score at or below: confirmed without asking (cash). */
  autoMax: number;
  /** At or below: asked in the chat. */
  botMax: number;
  /** At or below: the team calls; above: held for review. Paid orders above it are reviewed. */
  agentMax: number;
}

export const DEFAULT_ROUTING: RoutingSettings = { enabled: false, autoMax: 25, botMax: 60, agentMax: 85 };
const CASH = new Set(["cod", "partial", "unknown"]);
const PAID_ONLINE = new Set(["prepaid", "mixed", "store_credit"]);

/** The route for an order, or null when nothing should happen now (not a method that is confirmed, or waiting for a transfer). */
export function routeFor(o: { paymentMode: string; paid: boolean; score: number | null }, r: RoutingSettings): Route | null {
  if (!r.enabled) return o.paymentMode === "cod" || o.paymentMode === "partial" ? "bot" : null;
  if (CASH.has(o.paymentMode)) {
    if (o.score === null) return "bot";
    return o.score <= r.autoMax ? "auto" : o.score <= r.botMax ? "bot" : o.score <= r.agentMax ? "agent" : "hold";
  }
  if (PAID_ONLINE.has(o.paymentMode)) return o.score !== null && o.score > r.agentMax ? "hold" : "auto";
  if (o.paymentMode === "bnpl") return "auto";
  if (o.paymentMode === "bank_transfer") return o.paid ? "auto" : null;
  return null;
}
