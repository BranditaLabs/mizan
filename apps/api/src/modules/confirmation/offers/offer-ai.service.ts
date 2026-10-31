import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "kysely";
import { ClaudeOfferWriter, DriftMonitor, isIntegrationError, type OfferCandidateForAi } from "@mizan/engine";
import { fromMinor } from "@mizan/shared";
import { APP_CONFIG, type AppConfig } from "../../../platform/config.js";
import { Database } from "../../../platform/db/database.js";
import { MetricsService } from "../../../platform/metrics/metrics.service.js";
import { engineLogger, ENGINE_RUNTIME, type RuntimeFactory } from "../../../integrations/engine-registry.js";
import { money } from "../messages.js";
import { discounted, isOfferable } from "./recommend.js";

/** What the ai_offer step carries: our candidates and the order's items. Product facts only. */
export interface AiOfferPayload {
  offerId: string;
  currency: string;
  orderTotalMinor: string;
  orderVariantIds: string[];
  maxDiscountPct: string;
  /** The owner's rule fixed the item and discount: Claude only writes the message. */
  fixed: { variantId: string; discountPct: string } | null;
  order: Array<{ title: string; quantity: number }>;
  candidates: Array<{ variantId: string; title: string; priceMinor: string; costMinor: string | null; available: number | null; together: number; popular: number }>;
}

const MAX_ATTEMPTS = 3;

/**
 * Claude picks and words the offer (E6-12). Runs as a confirmation step: read the offer, call
 * Claude outside any transaction, then apply its answer only if the offer is still on the table
 * (not yet shown to the customer) and the pick passes every guard of `recommend` again; the price
 * is always Mizan's (Claude writes {price}, never a number). Anything else keeps Mizan's own offer.
 */
@Injectable()
export class OfferAi {
  private readonly logger = new Logger("OfferAi");
  private override: ClaudeOfferWriter | null | undefined;
  private configured: ClaudeOfferWriter | null | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Database) private readonly db: Database,
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject(ENGINE_RUNTIME) private readonly runtime: RuntimeFactory,
  ) {}

  /** Tests: the writer to use (null = none); undefined restores config. */
  use(writer: ClaudeOfferWriter | null | undefined): void {
    this.override = writer;
  }

  private get writer(): ClaudeOfferWriter | null {
    if (this.override !== undefined) return this.override;
    if (this.configured === undefined) {
      const key = this.config.ANTHROPIC_API_KEY;
      this.configured = key
        ? new ClaudeOfferWriter({ apiKey: key, model: this.config.ANTHROPIC_MODEL, baseUrl: this.config.ANTHROPIC_BASE_URL }, { ...this.runtime("platform"), logger: engineLogger("platform") }, new DriftMonitor())
        : null;
    }
    return this.configured;
  }

  get available(): boolean {
    return this.writer !== null;
  }

  /** One ai_offer step (claimed by the runner). */
  async run(tenantId: string, step: { id: string; run_id: string; attempts: number; payload: unknown }, now: Date): Promise<void> {
    const p = step.payload as AiOfferPayload;
    const done = async (result: string): Promise<void> => {
      this.metrics.aiOffers.inc({ result });
      await this.db.tenant(tenantId, (trx) => trx.updateTable("confirmation_steps").set({ status: "done", last_error: result === "picked" || result === "worded" ? null : result, updated_at: now }).where("id", "=", step.id).execute());
    };
    const writer = this.writer;
    if (!writer || !p?.offerId) return done("error");
    const ctx = await this.db.tenant(tenantId, async (trx) => ({ open: await this.stillOpen(trx, step.run_id, p.offerId), store: (await trx.selectFrom("tenants").select("name").where("id", "=", tenantId).executeTakeFirstOrThrow()).name }));
    if (!ctx.open) return done("late");

    // Short opaque ids for the model; product facts only.
    const ids = p.candidates.map((_, k) => `c${k + 1}`);
    const fmt = (minor: string) => money(fromMinor(BigInt(minor), p.currency), "ar");
    const candidates: OfferCandidateForAi[] = p.candidates.map((c, k) => ({
      id: ids[k]!, title: c.title, price: fmt(c.priceMinor), boughtTogether: c.together, popularity: c.popular,
      margin: c.costMinor === null ? "unknown" : marginBand(BigInt(c.priceMinor), BigInt(c.costMinor)),
    }));
    const fixedIdx = p.fixed ? p.candidates.findIndex((c) => c.variantId === p.fixed!.variantId) : -1;
    let result;
    try {
      result = await writer.pickOffer({
        store: ctx.store, order: p.order, candidates, maxDiscountPct: Math.floor(Number(p.maxDiscountPct)),
        ...(fixedIdx >= 0 ? { fixed: { id: ids[fixedIdx]!, discountPct: Math.floor(Number(p.fixed!.discountPct)) } } : {}),
      });
    } catch (err) {
      const retry = isIntegrationError(err) && err.retryable && step.attempts < MAX_ATTEMPTS;
      this.logger.warn({ tenantId, kind: isIntegrationError(err) ? err.kind : "unknown", retry }, "Claude offer pick failed");
      if (!retry) return done("error");
      await this.db.tenant(tenantId, (trx) => trx.updateTable("confirmation_steps").set({ status: "pending", run_at: new Date(now.getTime() + 60_000), locked_until: null, last_error: "retry", updated_at: now }).where("id", "=", step.id).execute());
      this.metrics.aiOffers.inc({ result: "retry" });
      return;
    }
    this.metrics.aiTokens.inc({ kind: "input" }, result.usage.input);
    this.metrics.aiTokens.inc({ kind: "output" }, result.usage.output);
    if (!result.pick) return done(result.reason === "refusal" ? "refusal" : "invalid");

    const chosen = p.candidates[ids.indexOf(result.pick.id)]!;
    // The owner's discount stands for a rule; Claude's otherwise (already within the store's max).
    const pct = p.fixed ? p.fixed.discountPct : String(result.pick.discountPct);
    const candidate = { variantId: chosen.variantId, title: chosen.title, priceMinor: BigInt(chosen.priceMinor), costMinor: chosen.costMinor === null ? null : BigInt(chosen.costMinor), available: chosen.available, active: true };
    if (Number(pct) > Number(p.maxDiscountPct) || !isOfferable({ orderVariantIds: p.orderVariantIds, orderTotalMinor: BigInt(p.orderTotalMinor), currency: p.currency }, candidate, pct)) return done("unsafe");
    const offerPrice = discounted(candidate.priceMinor, pct, p.currency);
    const fill = (m: string, lang: "ar" | "en") => m.replaceAll("{price}", money(fromMinor(offerPrice, p.currency), lang));

    const applied = await this.db.tenant(tenantId, async (trx) => {
      if (!(await this.stillOpen(trx, step.run_id, p.offerId))) return false;
      await trx.updateTable("order_offers").set({
        variant_id: candidate.variantId, unit_price_minor: candidate.priceMinor.toString(), discount_pct: pct, offer_price_minor: offerPrice.toString(),
        source: p.fixed ? "rule" : "ai", message_ar: fill(result.pick!.messageAr, "ar"), message_en: fill(result.pick!.messageEn, "en"), updated_at: now,
      }).where("id", "=", p.offerId).where("status", "=", "proposed").execute();
      return true;
    });
    return done(applied ? (p.fixed ? "worded" : "picked") : "late");
  }

  /** Still proposed, and the customer has not been shown it yet. */
  private async stillOpen(trx: Parameters<Parameters<Database["tenant"]>[1]>[0], runId: string, offerId: string): Promise<boolean> {
    const f = await trx.selectFrom("order_offers").select("status").where("id", "=", offerId).executeTakeFirst();
    if (f?.status !== "proposed") return false;
    const shown = await trx.selectFrom("confirmation_steps").select("id").where("run_id", "=", runId).where("kind", "=", "reply")
      .where(sql<boolean>`payload->>'message' = 'confirmed_offer'`).executeTakeFirst();
    return !shown;
  }
}

/** How much the store keeps on an item: high ≥ 40%, medium ≥ 20%, else low. */
export function marginBand(price: bigint, cost: bigint): "high" | "medium" | "low" {
  if (price <= 0n) return "low";
  const keep = ((price - cost) * 100n) / price;
  return keep >= 40n ? "high" : keep >= 20n ? "medium" : "low";
}
