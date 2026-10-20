import { describe, expect, it } from "vitest";
import { DriftMonitor } from "../src/adapt/drift.js";
import { Resolver } from "../src/adapt/resolve.js";
import { ShapeWatch } from "../src/adapt/shape.js";
import { shouldApplyStatus } from "../src/adapt/status.js";
import { CityResolver } from "../src/connectors/bosta/cities.js";
import { normalizeEgPhone } from "../src/connectors/bosta/connector.js";
import { CITIES } from "./fakes/bosta.js";

const ctx = (drift: DriftMonitor) => ({ connector: "x", entity: "order", drift, now: () => 0 });

describe("tolerant field resolution", () => {
  it("uses the first matching path and records a fallback as drift", () => {
    const drift = new DriftMonitor();
    const r = new Resolver({ customer: { phone: "0100" } }, ctx(drift));
    expect(r.str("phone", ["shippingAddress.phone", "customer.phone"])).toBe("0100");
    expect(drift.report()[0]).toMatchObject({ kind: "fallback_field", field: "phone" });
  });

  it("coerces wrapped and stringly-typed values", () => {
    const drift = new DriftMonitor();
    const r = new Resolver({ state: { code: 45, value: "Delivered" }, cod: "1,150" }, ctx(drift));
    expect(r.num("state", ["state"])).toBe(45);
    expect(r.num("cod", ["cod"])).toBe(1150);
    expect(drift.report().every((d) => d.kind === "coerced_value")).toBe(true);
  });

  it("reads GraphQL connections and plain arrays alike", () => {
    const drift = new DriftMonitor();
    expect(new Resolver({ a: { nodes: [1, 2] } }, ctx(drift)).arr("a", ["a"])).toEqual([1, 2]);
    expect(new Resolver({ a: { edges: [{ node: 3 }] } }, ctx(drift)).arr("a", ["a"])).toEqual([3]);
    expect(new Resolver({ a: [4] }, ctx(drift)).arr("a", ["a"])).toEqual([4]);
  });

  it("fails loudly, with the paths tried, only for required fields", () => {
    const drift = new DriftMonitor();
    const r = new Resolver({}, ctx(drift));
    expect(r.str("email", ["email"])).toBeUndefined();
    expect(() => r.str("id", ["id", "_id"], { required: true })).toThrow(/tried id, _id/);
    expect(drift.report()[0]).toMatchObject({ kind: "missing_field", field: "id" });
  });
});

describe("shape watch", () => {
  it("reports removed and retyped keys, learns additions", () => {
    const w = new ShapeWatch();
    expect(w.observe("e", { a: 1, b: { c: "x" } })).toBeNull();
    const d = w.observe("e", { a: "1", b: {}, z: true })!;
    expect(d.removed).toContain("b.c");
    expect(d.retyped[0]).toMatch(/^a: number → string/);
    expect(d.added).toContain("z");
  });
});

describe("shape watch: arrays", () => {
  it("does not report item fields as removed when a list is simply empty", () => {
    const w = new ShapeWatch();
    w.observe("e", { items: [{ id: 1, name: "a" }] });
    expect(w.observe("e", { items: [] })).toBeNull();
    expect(w.observe("e", { items: [{ id: 2, name: "b" }] })).toBeNull();
  });
});

describe("shipment status ordering guard", () => {
  it("never leaves a terminal status", () => {
    expect(shouldApplyStatus("delivered", "in_transit", 1, 2)).toBe(false);
  });
  it("ignores unknown statuses", () => {
    expect(shouldApplyStatus("in_transit", "unknown", 1, 2)).toBe(false);
  });
  it("drops stale events by timestamp", () => {
    expect(shouldApplyStatus("out_for_delivery", "in_transit", 200, 100)).toBe(false);
    expect(shouldApplyStatus("out_for_delivery", "failed_attempt", 100, 200)).toBe(true);
  });
  it("never moves back before pickup once collected", () => {
    expect(shouldApplyStatus("in_transit", "pickup_requested", 1, 2)).toBe(false);
  });
});

describe("city resolution", () => {
  const cities = CITIES.map((c) => ({ id: c._id, name: c.name, nameAr: c.nameAr }));
  const r = new CityResolver(cities);
  it.each([
    ["Cairo", undefined, "Cairo"],
    ["القاهرة", undefined, "Cairo"],
    ["Nasr City", "Cairo Governorate", "Cairo"],
    ["6th of October", undefined, "Giza"],
    ["Al Iskandariyah", undefined, "Alexandria"],
    ["الإسكندرية", undefined, "Alexandria"],
    ["Mansoura", "Ad Daqahliyah", "Dakahlia"],
    ["Zagazig", undefined, "Sharqia"],
  ])("%s / %s → %s", (city, province, expected) => {
    expect(r.resolve(city, province)?.city.name).toBe(expected);
  });
  it("returns null with suggestions for unknown places, then learns", () => {
    expect(r.resolve("Kafr Atlantis")).toBeNull();
    expect(r.suggest("Assyut").map((c) => c.name)).toContain("Assiut");
    const learned = new CityResolver(cities, new Map([["kafr atlantis", "c-giza"]]));
    expect(learned.resolve("Kafr Atlantis")).toMatchObject({ via: "learned", city: { name: "Giza" } });
  });
});

describe("phone normalization", () => {
  it.each([
    ["+20 100 123 4821", "01001234821"],
    ["00201001234821", "01001234821"],
    ["01001234821", "01001234821"],
    ["٠١٠٠١٢٣٤٨٢١", "01001234821"],
  ])("%s → %s", (input, out) => expect(normalizeEgPhone(input)).toBe(out));
});
