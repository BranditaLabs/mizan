import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { ProblemError } from "../../platform/http/problem.js";
import { PlatformSecrets } from "../../platform/secrets/platform-secrets.js";
import type { Plan } from "./plans.js";
import { trialEndsAt } from "./state.js";
import { SubscriptionService, type BillingInterval, type SubscriptionActor, type SubscriptionRow } from "./subscription.service.js";
import { trialKeys, type TrialIdentity } from "./trial-keys.js";

type Trx = Transaction<DB>;
/** What a new store may ask for at signup: a paid tier's trial (Enterprise leads get a Scale trial), or Free when it is sold publicly. */
export const SIGNUP_PLANS = ["growth", "scale", "enterprise", "free"] as const;
export type SignupPlan = (typeof SIGNUP_PLANS)[number];

export interface TrialStart { subscription: SubscriptionRow; trial: boolean; refused?: "trial_used" | "trials_off" }

/**
 * Trials (E12-2a2, docs/16 §7.3): a new store starts a `trial_days` trial of the tier it picked,
 * ending 23:59:59 on the last day in its time zone, once per owner, phone and shop domain
 * (claim_trial with platform-peppered HMACs, never a cross-store read). A store whose keys were
 * used before, or when trials are off (trial_days = 0), starts on Free; signup never fails for it.
 */
@Injectable()
export class TrialService {
  constructor(
    @Inject(SubscriptionService) private readonly subscriptions: SubscriptionService,
    @Inject(PlatformSecrets) private readonly secrets: PlatformSecrets,
  ) {}

  /** Inside the signup transaction (the new store's own context). */
  async startForSignup(trx: Trx, tenantId: string, input: { plan?: SignupPlan | undefined; interval?: BillingInterval | undefined; timezone: string; who: TrialIdentity; actor: SubscriptionActor; now?: Date }): Promise<TrialStart> {
    const settings = await this.subscriptions.settings(trx);
    const asked = input.plan ?? "growth";
    if (asked === "free") {
      const pub = await trx.selectFrom("billing_settings").select("free_tier_public").executeTakeFirstOrThrow();
      if (!pub.free_tier_public) throw new ProblemError(422, "validation_failed", "this plan is not offered", [{ path: "plan", code: "not_offered", message: "free" }]);
      return { subscription: await this.subscriptions.open(trx, tenantId, { event: "start", plan: "free", actor: input.actor, reason: "signup" }), trial: false };
    }
    const plan: Plan = asked === "enterprise" ? "scale" : asked;
    const data = { asked, interval: input.interval ?? "month" };
    const free = (refused: TrialStart["refused"]) => this.subscriptions.open(trx, tenantId, { event: "start", plan: "free", actor: input.actor, reason: refused, data })
      .then((subscription) => ({ subscription, trial: false, refused }));
    if (settings.trialDays <= 0) return free("trials_off");
    if (!(await this.claim(trx, tenantId, input.who))) return free("trial_used");
    const now = input.now ?? new Date();
    const subscription = await this.subscriptions.open(trx, tenantId, {
      event: "start_trial", plan, interval: input.interval ?? "month", trialEndsAt: trialEndsAt(now, input.timezone, settings.trialDays), now, actor: input.actor, reason: "signup", data,
    });
    return { subscription, trial: true };
  }

  /** Record these keys for the store; false when any was used by another store. */
  async claim(trx: Trx, tenantId: string, who: TrialIdentity): Promise<boolean> {
    const keys = trialKeys(this.secrets.trialKeyPepper(), who);
    if (!keys.length) return true; // nothing to tie the trial to: nothing to refuse
    const r = await sql<{ ok: boolean }>`SELECT claim_trial(${keys}::text[], ${tenantId}::uuid) AS ok`.execute(trx);
    return r.rows[0]?.ok === true;
  }
}
