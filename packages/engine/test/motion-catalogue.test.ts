import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENGINE_EVENT_TYPES, ENGINE_MOTION } from "@mizan/shared";

/**
 * Every event the engine emits has a row in the motion catalogue (BR-1, docs/16 §2.x): the literal
 * types in `this.emit(…)` (including both sides of a ternary) are in ENGINE_EVENT_TYPES and in
 * ENGINE_MOTION, and the catalogue lists nothing the engine never emits.
 */
const source = readFileSync(new URL("../src/engine/engine.ts", import.meta.url), "utf8");
const emitted = new Set([...source.matchAll(/this\.emit\(([^,]*),/g)].flatMap((m) => [...m[1].matchAll(/"([a-z_.]+)"/g)].map((x) => x[1])));

describe("engine events in the motion catalogue", () => {
  it("finds the engine's emits", () => {
    expect(emitted.size).toBeGreaterThan(40);
    expect(emitted).toContain("job.dead");
    expect(emitted).toContain("backfill.completed");
  });

  it.each([...emitted])("%s is catalogued with a motion", (type) => {
    expect(ENGINE_EVENT_TYPES as readonly string[]).toContain(type);
    expect(ENGINE_MOTION).toHaveProperty([type]);
  });

  it("the catalogue holds only types the engine emits", () => {
    expect([...ENGINE_EVENT_TYPES].filter((t) => !emitted.has(t))).toEqual([]);
  });

  it("no emit passes a computed type the scan cannot see", () => {
    const dynamic = [...source.matchAll(/this\.emit\(([^,]*),/g)].map((m) => m[1].trim()).filter((arg) => !/^(?:[\w.]+ \? )?"[a-z_.]+"(?: : "[a-z_.]+")?$/.test(arg));
    expect(dynamic).toEqual([]);
  });
});
