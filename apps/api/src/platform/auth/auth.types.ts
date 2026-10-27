import type { MemberRole } from "@mizan/shared";
import type { Request } from "express";
import type { VerifiedIdentity } from "./token-verifier.js";

export interface AuthUser {
  id: string;
  firebaseUid: string;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  language: "ar" | "en";
}

export interface AuthTenant {
  id: string;
  role: MemberRole;
}

/** Set on the request by AuthGuard. `tenant` is absent on @NoTenant routes. */
export interface AuthContext {
  identity: VerifiedIdentity;
  user: AuthUser;
  tenant?: AuthTenant;
  /** Client IP (behind the load balancer: X-Forwarded-For, trust proxy). */
  ip?: string;
  /** Set by PlatformGuard on /v1/platform routes (A-1). */
  staff?: { id: string; role: StaffRole };
  /** Set by AuthGuard when Mizan staff reach a store through a support grant (A-3) instead of a membership. */
  support?: SupportGrant;
}

/** An open support grant: the staff member acts in the store as an admin, read-only unless mode is write. */
export interface SupportGrant { grantId: string; staffId: string; mode: "read" | "write"; expiresAt: string }

export const STAFF_ROLES = ["super_admin", "support", "finance", "engineer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type AuthedRequest = Request & { auth?: AuthContext };
