import { describe, expect, it } from "vitest";
import { DOMAIN_EVENT_TYPES, isDomainEventType, matchesEvent } from "../src/events.js";

describe("domain events", () => {
  it("catalogue entries are unique entity.verb names", () => {
    expect(new Set(DOMAIN_EVENT_TYPES).size).toBe(DOMAIN_EVENT_TYPES.length);
    for (const t of DOMAIN_EVENT_TYPES) expect(t).toMatch(/^[a-z]+\.[a-z_]+$/);
    expect(isDomainEventType("order.created")).toBe(true);
    expect(isDomainEventType("order.exploded")).toBe(false);
  });

  it.each([
    ["*", "order.created", true],
    ["order.created", "order.created", true],
    ["order.*", "order.created", true],
    ["order.*", "orders.created", false],
    ["order.*", "shipment.created", false],
    ["order.created", "order.cancelled", false],
  ])("%s matches %s → %s", (p, t, ok) => expect(matchesEvent(p, t)).toBe(ok));
});
