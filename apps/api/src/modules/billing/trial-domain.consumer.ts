import { Inject, Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { DomainEvent } from "@mizan/shared";
import { EventConsumer, type EventHandler } from "../../platform/events/consumer.js";
import { SubscriptionService } from "./subscription.service.js";
import { TrialService } from "./trial.service.js";

/**
 * One trial per shop domain (E12-2a2): when a store connects its shop, the domain is claimed for
 * the store's trial. A domain that already had a trial in another Mizan store ends this store's
 * trial into Free at once (the store keeps working; staff can grant a trial). Event-driven, so the
 * connections code never calls billing (rule 14).
 */
@Injectable()
@EventConsumer({ name: "billing.trial-domain", events: ["connection.connected"] })
export class TrialDomainConsumer implements EventHandler {
  constructor(
    @Inject(TrialService) private readonly trials: TrialService,
    @Inject(SubscriptionService) private readonly subscriptions: SubscriptionService,
  ) {}

  async handle(event: DomainEvent, trx: Transaction<DB>): Promise<void> {
    if (event.data.kind !== "store") return;
    const c = await trx.selectFrom("connections").select(["external_account"]).where("id", "=", event.entity.id).executeTakeFirst();
    if (!c?.external_account) return;
    const sub = await this.subscriptions.live(trx, event.tenantId, true);
    if (!sub || sub.status !== "trialing") return;
    if (await this.trials.claim(trx, event.tenantId, { shopDomain: c.external_account })) return;
    await this.subscriptions.endTrial(trx, event.tenantId, sub, { type: "system" }, "trial_already_used");
  }
}
