import { MEMBER_ROLES } from "@mizan/shared";
import { z } from "zod";

const Role = z.enum(MEMBER_ROLES);

export const InviteSchema = z.strictObject({
  email: z.email().max(254).optional(),
  phone: z.string().max(32).optional(),
  role: Role,
}).refine((b) => Boolean(b.email) !== Boolean(b.phone), { message: "send exactly one of email or phone", path: ["email"] });
export type InviteBody = z.infer<typeof InviteSchema>;

export const UpdateMemberSchema = z.strictObject({
  role: Role.optional(),
  status: z.enum(["active", "disabled"]).optional(),
}).refine((b) => b.role !== undefined || b.status !== undefined, { message: "send role and/or status" });
export type UpdateMemberBody = z.infer<typeof UpdateMemberSchema>;

export interface MemberView {
  userId: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  joinedAt: string;
}

export interface InvitationView {
  id: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  /** Link to share (WhatsApp, SMS, email). Opening it still requires signing in with the invited email or phone. */
  acceptUrl: string;
}

/** An invitation addressed to the signed-in user (GET /me). */
export interface MyInvitationView {
  id: string;
  tenantId: string;
  tenantName: string;
  role: string;
  expiresAt: string;
}
