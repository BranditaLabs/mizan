import { MEMBER_ROLES, PERMISSION_NAMES } from "@mizan/shared";
import { z } from "zod";

/** A store the signed-in user belongs to (GET /v1/me): the tenant switcher's data. */
export const MembershipViewSchema = z.object({
  tenantId: z.uuid(),
  tenantName: z.string(),
  tenantSlug: z.string(),
  tenantLogo: z.string().nullable().describe("The store's logo, from Shopify (square when the store has one); null until read"),
  tenantStatus: z.enum(["active", "suspended"]).describe("Deleted stores are not listed"),
  country: z.string(),
  baseCurrency: z.string(),
  locale: z.string(),
  timezone: z.string(),
  role: z.enum(MEMBER_ROLES),
  /** What this role may do here (U6): the same names the API's routes and the web's screens check. */
  permissions: z.array(z.enum(PERMISSION_NAMES as [string, ...string[]])).describe("What this role may do in this store (U6)"),
  status: z.enum(["invited", "active", "disabled"]),
});
export type MembershipView = z.infer<typeof MembershipViewSchema>;
