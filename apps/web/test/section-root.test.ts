import { describe, expect, it } from "vitest";
import { sectionRoot } from "../src/lib/section-root";

describe("switching store lands on the section's own page", () => {
  it("cuts before an id; keeps pages without one", () => {
    expect(sectionRoot("/orders/3f2b1c4d-0a1b-4c2d-8e9f-0123456789ab")).toBe("/orders");
    expect(sectionRoot("/purchasing/orders/3f2b1c4d-0a1b-4c2d-8e9f-0123456789ab/receive")).toBe("/purchasing/orders");
    expect(sectionRoot("/products/new")).toBe("/products/new");
    expect(sectionRoot("/settings/team")).toBe("/settings/team");
    expect(sectionRoot("/tickets/1042")).toBe("/tickets");
    expect(sectionRoot("/")).toBe("/");
  });
});
