import { z } from "zod";
import { STAFF_ROLES } from "../../platform/auth/auth.types.js";

const Staff = z.object({
  id: z.uuid(), userId: z.uuid(), email: z.string().nullable(), name: z.string().nullable(),
  role: z.enum(STAFF_ROLES), status: z.enum(["active", "disabled"]), createdAt: z.iso.datetime(),
});
export const StaffSchema = Staff;
export const StaffListSchema = z.object({ data: z.array(Staff) });
export const StaffMeSchema = z.object({ id: z.uuid(), role: z.enum(STAFF_ROLES), email: z.string().nullable() });
export const AddStaffSchema = z.strictObject({ email: z.email().max(254).describe("A Mizan user who has signed in once"), role: z.enum(STAFF_ROLES) });
export const UpdateStaffSchema = z.strictObject({ role: z.enum(STAFF_ROLES).optional(), status: z.enum(["active", "disabled"]).optional() })
  .refine((b) => b.role !== undefined || b.status !== undefined, "change the role or the status");
export const TrailQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().min(1).optional().describe("Older than this line id (the previous page's nextBefore)"),
});
export const TrailSchema = z.object({
  data: z.array(z.object({
    id: z.number().int(), staffId: z.uuid().nullable(), email: z.string().nullable().describe("Who called: staff, or a non-staff user who was refused"),
    action: z.string().describe("The route called, or what was done"), outcome: z.enum(["ok", "denied", "failed"]), status: z.number().int().nullable(),
    target: z.object({ type: z.string(), id: z.string().nullable() }).nullable(), storeId: z.uuid().nullable(), at: z.iso.datetime(),
  })),
  nextBefore: z.number().int().nullable(),
});
