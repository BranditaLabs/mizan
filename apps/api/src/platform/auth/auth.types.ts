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
}

export type AuthedRequest = Request & { auth?: AuthContext };
