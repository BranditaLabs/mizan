import { MEMBER_ROLES } from "@mizan/shared";
import { z } from "zod";

/** A store the signed-in user belongs to (GET /v1/me): the tenant switcher's data. */
export const MembershipViewSchema = z.object({
  tenantId: z.uuid(),
  tenantName: z.string(),
  tenantSlug: z.string(),
  tenantStatus: z.enum(["trial", "active", "suspended"]).describe("Deleted stores are not listed"),
  country: z.string(),
  baseCurrency: z.string(),
  locale: z.string(),
  timezone: z.string(),
  role: z.enum(MEMBER_ROLES),
  status: z.enum(["invited", "active", "disabled"]),
});
export type MembershipView = z.infer<typeof MembershipViewSchema>;
