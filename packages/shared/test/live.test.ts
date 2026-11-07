import { describe, expect, it } from "vitest";
import { LIVE_TOPICS, liveTopicPermission, liveTopicsFor, parseLiveTopic } from "../src/live.js";
import { PERMISSIONS } from "../src/permissions.js";

const ORDER = "0b6f3f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const SHIPMENT = "1b6f3f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

describe("live topics (LV-1)", () => {
  it("parses named topics and one order's topic; anything else is refused", () => {
    for (const t of LIVE_TOPICS) expect(parseLiveTopic(t)).toBe(t);
    expect(parseLiveTopic(` order:${ORDER.toUpperCase()} `)).toBe(`order:${ORDER}`);
    expect(parseLiveTopic("order:123")).toBeNull();
    expect(parseLiveTopic("payments")).toBeNull();
    expect(parseLiveTopic("")).toBeNull();
  });

  it("every topic needs the permission that reads the same data", () => {
    for (const t of LIVE_TOPICS) {
      const p = liveTopicPermission(t);
      if (p !== null) expect(Object.keys(PERMISSIONS)).toContain(p);
    }
    expect(liveTopicPermission(`order:${ORDER}`)).toBe("orders.read");
    expect(liveTopicPermission("notifications")).toBeNull();
  });

  it("maps domain events to the topics they change", () => {
    expect(liveTopicsFor({ type: "order.created", entity: { type: "order", id: ORDER } })).toEqual(["orders", `order:${ORDER}`]);
    expect(liveTopicsFor({ type: "order.confirmed", entity: { type: "order", id: ORDER } })).toEqual(["orders", `order:${ORDER}`, "confirmation"]);
    expect(liveTopicsFor({ type: "shipment.status_changed", entity: { type: "shipment", id: SHIPMENT }, orderId: ORDER })).toEqual([`order:${ORDER}`, "shipments"]);
    expect(liveTopicsFor({ type: "refund.created", entity: { type: "order", id: ORDER } })).toEqual(["orders", `order:${ORDER}`, "refunds"]);
    expect(liveTopicsFor({ type: "ticket.created", entity: { type: "ticket", id: SHIPMENT }, orderId: null })).toEqual(["tickets"]);
    expect(liveTopicsFor({ type: "connection.needs_attention", entity: { type: "connection", id: SHIPMENT } })).toEqual(["connections"]);
    expect(liveTopicsFor({ type: "sync.recovered", entity: { type: "tenant", id: SHIPMENT } })).toEqual(["connections"]);
    expect(liveTopicsFor({ type: "stock.low", entity: { type: "variant", id: SHIPMENT } })).toEqual([]);
    expect(liveTopicsFor({ type: "shipment.created", entity: { type: "shipment", id: SHIPMENT }, orderId: "not-a-uuid" })).toEqual(["shipments"]);
  });
});
