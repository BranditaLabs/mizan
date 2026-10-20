import type { ShipmentStatus } from "@mizan/shared";
import type { DriftSink } from "./drift.js";

/**
 * Data-driven status mapping.
 *
 * Couriers describe the same event with different codes, and change them.
 * A mapping is resolved in this order:
 *   1. merchant or ops overrides (set from the dashboard, no deploy)
 *   2. exact code table
 *   3. label rules (regex on the courier's text, English or Arabic)
 *   4. unknown → "unknown", recorded as drift, order flagged for review
 *
 * Unknown never guesses a terminal status. Marking an order delivered or
 * returned by mistake moves money; waiting for a person does not.
 */
export interface StatusRule {
  pattern: RegExp;
  status: ShipmentStatus;
}

export interface StatusMapperConfig {
  connector: string;
  codes: Record<string, ShipmentStatus>;
  labels: StatusRule[];
}

export class StatusMapper {
  private readonly overrides = new Map<string, ShipmentStatus>();

  constructor(
    private readonly cfg: StatusMapperConfig,
    private readonly drift: DriftSink,
    private readonly now: () => number,
    /** Codes already learned elsewhere (e.g. from earlier labels) are not news. */
    private readonly isLearned: (code: string) => boolean = () => false,
  ) {}

  setOverride(code: string | number, status: ShipmentStatus) {
    this.overrides.set(String(code), status);
  }

  map(raw: { code?: string | number; label?: string }, sample?: unknown): { status: ShipmentStatus; via: "override" | "code" | "label" | "unknown" } {
    const code = raw.code === undefined || raw.code === null ? undefined : String(raw.code);
    if (code && this.overrides.has(code)) return { status: this.overrides.get(code)!, via: "override" };
    if (code && this.cfg.codes[code]) return { status: this.cfg.codes[code], via: "code" };
    const label = raw.label?.trim();
    if (label) {
      for (const r of this.cfg.labels) {
        if (r.pattern.test(label)) {
          if (code && !this.isLearned(code)) {
            this.drift.record({
              connector: this.cfg.connector, entity: "shipment", kind: "learned_status", field: "state",
              detail: `code ${code} learned from label "${label}" → ${r.status}`, sample, at: this.now(),
            });
          }
          return { status: r.status, via: "label" };
        }
      }
    }
    this.drift.record({
      connector: this.cfg.connector, entity: "shipment", kind: "unknown_status", field: "state",
      detail: `code ${code ?? "∅"} label "${label ?? ""}" not mapped`, sample, at: this.now(),
    });
    return { status: "unknown", via: "unknown" };
  }
}

/**
 * Ordering guard for out-of-order events. Webhooks and polls can arrive late
 * or twice; a later "in transit" must not overwrite "delivered".
 * Higher rank wins; equal rank lets the newer event win; returns are allowed
 * to follow a failed attempt or delivery exception.
 */
const RANK: Record<ShipmentStatus, number> = {
  unknown: 0,
  created: 10,
  pickup_requested: 20,
  picked_up: 30,
  in_transit: 40,
  exception: 45,
  out_for_delivery: 50,
  failed_attempt: 55,
  returning: 60,
  delivered: 100,
  returned: 100,
  cancelled: 100,
  lost: 100,
};

export function shouldApplyStatus(current: ShipmentStatus | undefined, next: ShipmentStatus, currentAt?: number, nextAt?: number): boolean {
  if (!current || current === "unknown") return next !== "unknown";
  if (next === "unknown") return false; // keep the last known good status; the drift event flags it
  if (RANK[current] === 100) return false; // terminal states are final; corrections go through ops
  // A parcel that has left the merchant never goes back to "created" / "pickup requested".
  if (RANK[current] >= RANK.picked_up && RANK[next] < RANK.picked_up) return false;
  if (RANK[next] === 100) return true; // a terminal event always wins over an in-flight one
  if (nextAt !== undefined && currentAt !== undefined) {
    if (nextAt !== currentAt) return nextAt > currentAt; // timestamps decide order
    return RANK[next] >= RANK[current];
  }
  // No timestamps: only move forward, plus the known re-delivery loop.
  if (RANK[next] >= RANK[current]) return true;
  return (current === "failed_attempt" || current === "exception") && (next === "out_for_delivery" || next === "in_transit");
}
