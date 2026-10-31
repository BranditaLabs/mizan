import { describe, expect, it } from "vitest";
import { isMemberRole, MEMBER_ROLES, MFA_REQUIRED_ROLES, ROLE_LABELS } from "../src/roles.js";

describe("roles", () => {
  it("every role has Arabic and English labels", () => {
    for (const r of MEMBER_ROLES) expect(ROLE_LABELS[r].ar && ROLE_LABELS[r].en).toBeTruthy();
  });
  it("guards role strings", () => {
    expect(isMemberRole("owner")).toBe(true);
    expect(isMemberRole("cashier")).toBe(false);
    expect([...MFA_REQUIRED_ROLES].sort()).toEqual(["admin", "owner"]);
  });
});
