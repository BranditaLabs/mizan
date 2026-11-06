import { applyDecorators, Inject, Injectable, SetMetadata, UseGuards, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiResponse } from "@nestjs/swagger";
import { FEATURE_PLAN, hasFeature, isPlan, type Feature } from "@mizan/shared";
import type { AuthedRequest } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { PROBLEM_CONTENT_TYPE, ProblemError } from "../../platform/http/problem.js";
import { FlagsService } from "../flags/flags.service.js";

export const ENTITLEMENT = "mizan:entitlement";
/** The A-6 flag that turns gating on per store (off by default; on only after pilots are comped, docs/16 §11.0b). */
export const ENTITLEMENTS_FLAG = "entitlements";

/**
 * Plan gating (E12-2a3): a store whose plan lacks the feature gets 402 plan_required, with the
 * feature and the plan that includes it in `errors` ({ path: "feature" | "plan", code }). The
 * dashboard shows a locked preview of the screen, never a 404. Only while the store's
 * `entitlements` flag is on; with it off (the default) every plan reaches every route as before.
 */
@Injectable()
export class EntitledGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(Database) private readonly db: Database,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<Feature | undefined>(ENTITLEMENT, [ctx.getHandler(), ctx.getClass()]);
    const tenantId = ctx.switchToHttp().getRequest<AuthedRequest>().auth?.tenant?.id;
    if (!feature || !tenantId) return true;
    if (!(await this.flags.isEnabled(tenantId, ENTITLEMENTS_FLAG))) return true;
    const t = await this.db.tenant(tenantId, (trx) => trx.selectFrom("tenants").select("plan").where("id", "=", tenantId).executeTakeFirst());
    if (t && isPlan(t.plan) && hasFeature(t.plan, feature)) return true;
    throw new ProblemError(402, "plan_required", `this needs the ${FEATURE_PLAN[feature]} plan`, [{ path: "feature", code: feature }, { path: "plan", code: FEATURE_PLAN[feature] }]);
  }
}

/** Gate a route or controller on a plan feature (see EntitledGuard). */
export const Entitled = (feature: Feature) => applyDecorators(
  SetMetadata(ENTITLEMENT, feature),
  UseGuards(EntitledGuard),
  ApiResponse({ status: 402, description: `The store's plan does not include ${feature} (plan_required; only when gating is on for the store)`, content: { [PROBLEM_CONTENT_TYPE]: { schema: { $ref: "#/components/schemas/ProblemDetails" } } } }),
);
