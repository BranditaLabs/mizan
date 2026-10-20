import { createParamDecorator, SetMetadata, type ExecutionContext } from "@nestjs/common";
import type { MemberRole } from "@mizan/shared";
import type { AuthContext, AuthedRequest } from "./auth.types.js";

export const IS_PUBLIC = "mizan:public";
export const NO_TENANT = "mizan:no-tenant";
export const ROLES = "mizan:roles";

/** No sign-in needed (health, webhooks with their own verification). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Signed in, but no X-Tenant-Id needed (GET /me, POST /tenants). */
export const NoTenant = () => SetMetadata(NO_TENANT, true);

/** Only these member roles may call the route (on top of membership). */
export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES, roles);

/** The caller's AuthContext, as set by AuthGuard. */
export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new Error("@Auth() used on a route that AuthGuard did not authenticate");
  return auth;
});
