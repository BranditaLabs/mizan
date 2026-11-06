import { MEMBER_ROLES } from "@mizan/shared";
import { describe, expect, it } from "vitest";
import { can } from "@mizan/shared";
import { activeKey, NAV, navFor, primaryFor } from "../src/lib/nav";
import { activeSetting, settingsFor } from "../src/lib/settings-nav";

describe("navigation follows the role (U3)", () => {
  it("every role has a home and only sections it can open; owners see everything", () => {
    for (const role of MEMBER_ROLES) {
      const keys = navFor(role).map((n) => n.key);
      expect(keys).toContain("home");
      for (const n of NAV) expect(keys.includes(n.key)).toBe(n.can === null || n.can.some((p) => can(role, p)));
    }
    expect(navFor("owner")).toHaveLength(NAV.length);
    expect(navFor(undefined)).toEqual([]);
  });

  it("a media buyer lands on the ads pages; agents and warehouse never see money", () => {
    const buyer = navFor("media_buyer");
    expect(buyer.find((n) => n.key === "profit")).toMatchObject({ href: "/profit/ads" });
    expect(buyer.map((n) => n.key)).not.toContain("settings"); // ad spend lives under Profit now
    for (const role of ["agent", "warehouse"]) expect(navFor(role).map((n) => n.key)).not.toEqual(expect.arrayContaining(["payments"]));
  });

  it("the phone bar: up to four of the role's own sections", () => {
    for (const role of MEMBER_ROLES) {
      const bar = primaryFor(role);
      expect(bar.length).toBeGreaterThan(0);
      expect(bar.length).toBeLessThanOrEqual(4);
      const mine = navFor(role).map((n) => n.key);
      for (const n of bar) expect(mine).toContain(n.key);
    }
    expect(primaryFor("agent")[0]!.key).toBe("confirmation");
  });

  it("marks the open section from the path", () => {
    const owner = navFor("owner");
    expect(activeKey(owner, "/")).toBe("home");
    expect(activeKey(owner, "/orders/3f2b1c4d-0a1b-4c2d-8e9f-0123456789ab")).toBe("orders");
    expect(activeKey(owner, "/settings/team")).toBe("settings");
    expect(activeKey(owner, "/stock")).toBe("warehouse");
    expect(activeKey(owner, "/ordersx")).toBeNull();
  });
});

describe("settings menu (U4, E6-16b)", () => {
  it("the studio sits right after Confirmation, for those who manage confirmation", () => {
    const keys = settingsFor("owner").map((p) => p.key);
    expect(keys.indexOf("studio")).toBe(keys.indexOf("confirmation") + 1);
    expect(settingsFor("agent").map((p) => p.key)).not.toContain("studio");
  });

  it("marks one page: the longest path that matches", () => {
    const pages = settingsFor("owner");
    expect(activeSetting(pages, "/settings/confirmation")).toBe("confirmation");
    expect(activeSetting(pages, "/settings/confirmation/studio")).toBe("studio");
    expect(activeSetting(pages, "/settings/after-confirmation")).toBe("afterConfirmation");
    expect(activeSetting(pages, "/settings")).toBeNull();
  });
});
