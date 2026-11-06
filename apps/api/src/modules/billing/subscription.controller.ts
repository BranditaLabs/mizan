import { Controller, Get, Inject } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Can } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { ApiJson } from "../../platform/http/api-schema.js";
import { ProblemError } from "../../platform/http/problem.js";
import type { Plan } from "./plans.js";
import { entitlementPlan, trialDaysLeft, type SubscriptionStatus } from "./state.js";
import { SubscriptionViewSchema, type SubscriptionView } from "./subscription.dto.js";
import { SubscriptionService } from "./subscription.service.js";

/** The store's subscription (E12-2a3): plan, status and the trial with its days left in the store's time zone. */
@ApiTags("billing")
@Controller("billing")
export class SubscriptionController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(SubscriptionService) private readonly subscriptions: SubscriptionService,
  ) {}

  @Get("subscription")
  @Can("billing.read")
  @ApiJson(200, "Subscription", SubscriptionViewSchema, "The plan the store has now, its subscription's status, and a running trial with its end and days left")
  get(@Auth() auth: AuthContext): Promise<SubscriptionView> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const t = await trx.selectFrom("tenants").select(["timezone"]).where("id", "=", tenantId).executeTakeFirstOrThrow();
      const s = await this.subscriptions.live(trx, tenantId);
      if (!s) throw new ProblemError(404, "subscription_not_found", "this store has no subscription");
      const last = await trx.selectFrom("subscription_events").select(["to_plan", "at"]).where("event", "=", "trial_end").orderBy("id", "desc").limit(1).executeTakeFirst();
      const status = s.status as SubscriptionStatus;
      const now = new Date();
      return {
        plan: entitlementPlan({ status, plan: s.plan_code as Plan, previousStatus: s.previous_status as SubscriptionStatus | null }),
        status, subscribedPlan: s.plan_code as Plan, interval: s.billing_interval as "month" | "year", comped: s.comp_percent === 100,
        cancelAtPeriodEnd: s.cancel_at_period_end, currentPeriodEnd: s.current_period_end?.toISOString() ?? null, timezone: t.timezone,
        trial: status === "trialing" && s.trial_started_at && s.trial_ends_at
          ? { plan: s.plan_code as Plan, startedAt: s.trial_started_at.toISOString(), endsAt: s.trial_ends_at.toISOString(), daysLeft: trialDaysLeft(s.trial_ends_at, now, t.timezone) }
          : null,
        lastTrial: last ? { plan: last.to_plan as Plan, endedAt: last.at.toISOString() } : null,
      };
    });
  }
}
