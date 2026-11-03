import { describe, expect, it } from "vitest";
import { can, PERMISSIONS, permissionsFor, rolesWith, type Permission } from "../src/permissions.js";
import { MEMBER_ROLES } from "../src/roles.js";

describe("permissions (U6)", () => {
  it("only known roles; the owner can do everything", () => {
    for (const [p, roles] of Object.entries(PERMISSIONS)) {
      for (const r of roles) expect(MEMBER_ROLES as readonly string[]).toContain(r);
      expect(can("owner", p as Permission)).toBe(true);
    }
  });

  it("money stays with the people who handle it; nobody without a role gets anything", () => {
    for (const role of ["agent", "warehouse"]) {
      for (const p of ["payments.read", "refunds.approve", "profit.read", "disputes.manage"] as const) expect(can(role, p)).toBe(false);
    }
    expect(can("finance", "refunds.approve")).toBe(true);
    expect(can("ops_manager", "refunds.approve")).toBe(false);
    expect(can("media_buyer", "ads.spend")).toBe(true);
    expect(can("media_buyer", "profit.read")).toBe(false);
    expect(permissionsFor(undefined)).toEqual([]);
    expect(can("", "orders.read")).toBe(false);
  });

  it("permissionsFor and rolesWith agree with the table", () => {
    for (const role of MEMBER_ROLES) {
      for (const p of permissionsFor(role)) expect(rolesWith(p).has(role)).toBe(true);
    }
  });
});
