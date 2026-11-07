import { scrubGhostFields, type GhostField } from "@mizan/design-system/auth-motion";
import { describe, expect, it } from "vitest";
import { GEOMETRY, LABEL_END, nodeWidth } from "../src/components/auth/stage/geometry";

/** A field as cloneNode leaves it: the live value copied (the dirty flag too), attributes as they were. */
const field = (type: string, value: string, attrs: string[] = []): GhostField => ({ type, value, hasAttribute: (n) => attrs.includes(n) });
const clone = (f: GhostField): GhostField => field(f.type, f.value, ["data-secret"].filter((a) => f.hasAttribute(a)));

describe("the exit copy of a step (StepHost's ghost) never holds a typed secret", () => {
  it("a password keeps type=password and holds filler of the same length, never the value", () => {
    const live = [field("email", "owner@example.com"), field("password", "hunter2", ["data-secret"])];
    const copies = live.map(clone);
    scrubGhostFields(copies, live);
    expect(copies[0]).toMatchObject({ type: "email", value: "owner@example.com" });
    expect(copies[1]!.type).toBe("password");
    expect(copies[1]!.value).toBe("•".repeat(7));
    expect(copies.some((c) => c.value === "hunter2")).toBe(false);
  });
  it("a password shown with \"Show\" (type=text) is hidden again in the copy", () => {
    const live = [field("text", "hunter2", ["data-secret"])];
    const copies = live.map(clone);
    scrubGhostFields(copies, live);
    expect(copies[0]).toMatchObject({ type: "password", value: "•••••••" });
  });
  it("an empty password stays empty; a long one is capped", () => {
    const live = [field("password", ""), field("password", "x".repeat(60))];
    const copies = live.map(clone);
    scrubGhostFields(copies, live);
    expect(copies.map((c) => c.value)).toEqual(["", "•".repeat(24)]);
  });
});

describe("the stage map's pills follow their labels", () => {
  it("as wide as the mark, the label as drawn and 14px after it", () => {
    expect(LABEL_END).toBe(14);
    expect(nodeWidth({ h: 38 }, 80)).toBe(38 + 4 + 80 + 14);
    expect(nodeWidth({ h: 38 }, 80.2)).toBe(137);
  });
  it("no node carries a hard-coded monogram any more (DS-3 decides the mark)", () => {
    for (const g of Object.values(GEOMETRY)) for (const n of g.nodes) expect(Object.keys(n)).toEqual(["id", "x", "y", "w", "h"]);
  });
});
