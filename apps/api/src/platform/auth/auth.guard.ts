import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { routeTemplate, type HttpReply } from "../http/http.types.js";
import { Reflector } from "@nestjs/core";
import { MFA_REQUIRED_ROLES, type MemberRole } from "@mizan/shared";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { ProblemError } from "../http/problem.js";
import { RateLimiter } from "../http/rate-limit.js";
import { AuthService } from "./auth.service.js";
import type { AuthedRequest, SupportGrant } from "./auth.types.js";
import { IS_PUBLIC, NO_SUPPORT, NO_TENANT, ROLES } from "./decorators.js";
import { TOKEN_VERIFIER, type TokenVerifier } from "./token-verifier.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READ_METHODS = new Set(["GET", "HEAD"]);
/** What support access acts as inside a store. */
const SUPPORT_ROLE: MemberRole = "admin";
const BEARER = /^Bearer ([A-Za-z0-9\-_.]+)$/;

/**
 * Global guard: every route needs a signed-in user unless marked @Public().
 *
 * 1. Bearer Firebase ID token → verified identity → Mizan user (created on first sign-in).
 * 2. Unless @NoTenant(): X-Tenant-Id must name a tenant where the user is an *active* member.
 *    Unknown tenant, no membership, invited or disabled all answer the same 403, so tenant ids cannot be probed.
 * 3. Owners and admins need a second factor when AUTH_REQUIRE_MFA (default on in production).
 * 4. @Roles(...) narrows further.
 * 5. A non-member who is Mizan staff with an open support grant (A-3) acts as an admin: read-only
 *    unless the grant is for writing, never on @NoSupport routes, every call in the staff trail.
 * Rate limits: per IP before the token is checked, per user after (RateLimiter).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const res = ctx.switchToHttp().getResponse<HttpReply>();
    // Cheap per-IP check first: floods of bad tokens are refused before any verification work.
    this.limits.checkIp(req.ip, res);
    const token = BEARER.exec(req.headers.authorization ?? "")?.[1];
    if (!token) throw new ProblemError(401, "unauthorized", "send a Firebase ID token as Authorization: Bearer <token>");

    const identity = await this.verifier.verify(token);
    this.limits.checkUser(identity.uid, res);
    const user = await this.auth.resolveUser(identity);
    req.auth = { identity, user, ...(req.ip ? { ip: req.ip } : {}) };

    if (this.reflector.getAllAndOverride<boolean>(NO_TENANT, targets)) return true;

    const tenantId = req.headers["x-tenant-id"];
    if (typeof tenantId !== "string" || !tenantId) throw new ProblemError(400, "tenant_header_required", "send the store id as X-Tenant-Id");
    if (!UUID.test(tenantId)) throw new ProblemError(400, "invalid_tenant_id", "X-Tenant-Id must be a UUID");

    const membership = await this.auth.membership(tenantId, user.id);
    if ((!membership || membership.status !== "active") && identity.secondFactor) {
      // Not a member: Mizan staff may still be here through an open support grant (A-3).
      const grant = await this.auth.supportGrant(tenantId, user.id);
      if (grant) return this.asSupport(req, targets, tenantId, grant);
    }
    if (!membership || membership.status !== "active") {
      throw new ProblemError(403, "not_a_member", "you are not an active member of this store");
    }
    if (membership.tenantStatus === "suspended" || membership.tenantStatus === "deleted") {
      throw new ProblemError(403, "tenant_inactive", `this store is ${membership.tenantStatus}`);
    }
    const requireMfa = this.config.AUTH_REQUIRE_MFA ?? this.config.NODE_ENV === "production";
    if (requireMfa && MFA_REQUIRED_ROLES.has(membership.role) && !identity.secondFactor) {
      throw new ProblemError(403, "mfa_required", "owners and admins must sign in with two-step verification");
    }
    const allowed = this.reflector.getAllAndOverride<MemberRole[] | undefined>(ROLES, targets);
    if (allowed?.length && !allowed.includes(membership.role)) {
      throw new ProblemError(403, "insufficient_role", `this action needs one of: ${allowed.join(", ")}`);
    }

    req.auth.tenant = { id: tenantId, role: membership.role };
    return true;
  }

  /**
   * Support access (A-3): the staff member acts as an admin of the store (owner-only routes stay
   * closed), only reads unless a super admin opened the grant for writing, and every call is in the
   * staff trail. A suspended store can still be looked into; a deleted one cannot.
   */
  private async asSupport(req: AuthedRequest, targets: Function[], tenantId: string, grant: SupportGrant & { tenantStatus: string }): Promise<boolean> {
    const auth = req.auth!;
    if (grant.tenantStatus === "deleted") throw new ProblemError(403, "tenant_inactive", "this store is deleted");
    if (this.reflector.getAllAndOverride<boolean>(NO_SUPPORT, targets)) {
      throw new ProblemError(403, "support_not_allowed", "support access does not reach this");
    }
    if (grant.mode === "read" && !READ_METHODS.has(req.method)) {
      throw new ProblemError(403, "support_read_only", "support access to this store is read-only");
    }
    const allowed = this.reflector.getAllAndOverride<MemberRole[] | undefined>(ROLES, targets);
    if (allowed?.length && !allowed.includes(SUPPORT_ROLE)) {
      throw new ProblemError(403, "insufficient_role", `this action needs one of: ${allowed.join(", ")}`);
    }
    const { tenantStatus: _, ...support } = grant;
    await this.auth.recordSupportCall(support, auth.user.id, tenantId, `${req.method} ${routeTemplate(req)}`, auth.ip);
    auth.support = support;
    auth.tenant = { id: tenantId, role: SUPPORT_ROLE };
    return true;
  }
}
