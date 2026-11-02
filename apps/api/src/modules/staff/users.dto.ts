import { z } from "zod";
import { STAFF_ROLES } from "../../platform/auth/auth.types.js";

export const UsersQuerySchema = z.object({
  q: z.string().trim().min(2).max(100).optional().describe("Email, phone (+20…), name or user id"),
  disabled: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
const UserRow = z.object({
  id: z.uuid(), email: z.string().nullable(), phone: z.string().nullable(), name: z.string().nullable(), createdAt: z.iso.datetime(),
  disabled: z.object({ at: z.iso.datetime(), reason: z.string() }).nullable(),
  stores: z.number().int().describe("Stores they belong to"),
  staffRole: z.enum(STAFF_ROLES).nullable(),
});
export const UsersPageSchema = z.object({ data: z.array(UserRow), total: z.number().int(), nextOffset: z.number().int().nullable() });
export const UserDetailSchema = UserRow.extend({
  memberships: z.array(z.object({ storeId: z.uuid(), storeName: z.string(), storeStatus: z.string(), role: z.string(), status: z.string(), joinedAt: z.iso.datetime() })),
});
export const DisableUserSchema = z.strictObject({ reason: z.string().trim().min(3).max(500).describe("Shown to the stores they belong to") });
