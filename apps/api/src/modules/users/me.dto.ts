import { z } from "zod";
import { MembershipViewSchema } from "../../platform/auth/membership.schema.js";
import { MyInvitationViewSchema } from "../members/members.dto.js";

/** GET /v1/me. */
export const MeSchema = z.object({
  user: z.object({
    id: z.uuid(),
    firebaseUid: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable().describe("E.164"),
    displayName: z.string().nullable(),
    language: z.enum(["ar", "en"]),
    emailVerified: z.boolean(),
    /** Signed in with a second factor (owners and admins need it in stores). */
    mfa: z.boolean().describe("Signed in with a second factor (owners and admins need it in stores)"),
  }),
  memberships: z.array(MembershipViewSchema),
  /** Pending invitations addressed to my verified email or phone. */
  invitations: z.array(MyInvitationViewSchema).describe("Pending invitations addressed to my verified email or phone"),
});
export type MeResponse = z.infer<typeof MeSchema>;
