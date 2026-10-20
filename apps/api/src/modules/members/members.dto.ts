import { MEMBER_ROLES } from "@mizan/shared";
import { z } from "zod";


export const InviteSchema = z.strictObject({
  email: z.email().max(254).optional(),
  phone: z.string().max(32).optional(),
  role: z.enum(MEMBER_ROLES),
}).refine((b) => Boolean(b.email) !== Boolean(b.phone), { message: "send exactly one of email or phone", path: ["email"] });
export type InviteBody = z.infer<typeof InviteSchema>;

export const UpdateMemberSchema = z.strictObject({
  role: z.enum(MEMBER_ROLES).optional(),
  status: z.enum(["active", "disabled"]).optional(),
}).refine((b) => b.role !== undefined || b.status !== undefined, { message: "send role and/or status" });
export type UpdateMemberBody = z.infer<typeof UpdateMemberSchema>;

const MemberRoleSchema = z.enum(MEMBER_ROLES);

export const MemberViewSchema = z.object({
  userId: z.uuid(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable().describe("E.164"),
  role: MemberRoleSchema,
  status: z.enum(["active", "invited", "disabled"]),
  joinedAt: z.iso.datetime(),
});
export type MemberView = z.infer<typeof MemberViewSchema>;
export type MemberStatus = MemberView["status"];

export const InvitationViewSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  role: MemberRoleSchema,
  status: z.enum(["pending", "accepted", "revoked"]),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  /** Link to share (WhatsApp, SMS, email). Opening it still requires signing in with the invited email or phone. */
  acceptUrl: z.url().describe("Link to share; opening it still requires signing in with the invited email or phone"),
});
export type InvitationView = z.infer<typeof InvitationViewSchema>;
export type InvitationStatus = InvitationView["status"];

export const TeamSchema = z.object({ members: z.array(MemberViewSchema), invitations: z.array(InvitationViewSchema) });

/** An invitation addressed to the signed-in user (GET /me). */
export const MyInvitationViewSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  tenantName: z.string(),
  role: MemberRoleSchema,
  expiresAt: z.iso.datetime(),
});
export type MyInvitationView = z.infer<typeof MyInvitationViewSchema>;

export const AcceptedInvitationSchema = z.object({ tenantId: z.uuid(), role: MemberRoleSchema });
