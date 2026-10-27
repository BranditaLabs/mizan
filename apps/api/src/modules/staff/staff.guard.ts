import { Inject, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthedRequest, StaffRole } from "../../platform/auth/auth.types.js";
import { ProblemError } from "../../platform/http/problem.js";
import { StaffService } from "./staff.service.js";

export const STAFF_ROLES_KEY = "mizan:staff-roles";
/** Only these staff roles (on top of being active staff with two-step sign-in). */
export const StaffRoles = (...roles: StaffRole[]) => SetMetadata(STAFF_ROLES_KEY, roles);

/** "GET /v1/platform/staff/:id": the route, never ids or query strings. */
export const routeOf = (req: AuthedRequest) => `${req.method} ${(req.baseUrl ?? "") + ((req.route as { path?: string } | undefined)?.path ?? req.path)}`;

/**
 * PlatformGuard (A-1): /v1/platform/* is for Mizan staff only. After the global guard has verified
 * the user (these routes are @NoTenant), the caller must be active staff, signed in with a second
 * factor (always: there is no switch for staff), with one of the route's roles. Every refusal is
 * recorded in the staff trail — a merchant probing the back office included.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(StaffService) private readonly staff: StaffService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const auth = req.auth;
    if (!auth) throw new ProblemError(401, "unauthorized", "sign in first");
    const deny = async (status: number, code: string, message: string, staffId?: string): Promise<never> => {
      await this.staff.audit({ staffId: staffId ?? null, userId: auth.user.id, action: routeOf(req), outcome: "denied", status, data: { code }, ...(auth.ip ? { ip: auth.ip } : {}) });
      throw new ProblemError(status, code, message);
    };
    // Two-step sign-in first: without it nobody is staff, and nobody is bootstrapped.
    if (!auth.identity.secondFactor) return deny(403, "mfa_required", "staff must sign in with two-step verification");
    const s = await this.staff.resolve(auth);
    if (!s) return deny(403, "not_staff", "the back office is for Mizan staff only");
    if (s.status !== "active") return deny(403, "staff_disabled", "your staff access is disabled", s.id);
    const allowed = this.reflector.getAllAndOverride<StaffRole[] | undefined>(STAFF_ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (allowed?.length && !allowed.includes(s.role)) return deny(403, "insufficient_role", `this needs one of: ${allowed.join(", ")}`, s.id);
    auth.staff = { id: s.id, role: s.role };
    return true;
  }
}
