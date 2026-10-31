import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { fromMinor, toMinor } from "@mizan/shared";
import { AuditService, auditActor } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { Database } from "../../platform/db/database.js";
import { EventsService } from "../../platform/events/events.service.js";
import { ProblemError } from "../../platform/http/problem.js";
import type { CostRuleKind, CostRuleView, CreateCostRule } from "./cost-rules.dto.js";
import { addDays, asDate, dayText, localDay, storeClock } from "./store-day.js";

type Scope = Record<string, string>;
const SELECT = ["id", "kind", "scope", "amount_minor", "return_minor", "fixed_minor", "pct", "currency", "created_at"] as const;
type Row = {
  id: string; kind: string; scope: unknown; amount_minor: string | null; return_minor: string | null; fixed_minor: string | null;
  pct: string | null; currency: string | null; created_at: Date; valid_from: string; valid_to: string | null;
};

/** Backdating is for "I forgot to enter it": a quarter at most. Future versions up to a year. */
const MAX_BACK_DAYS = 90;
const MAX_AHEAD_DAYS = 365;

const cleanScope = (scope: unknown): Scope =>
  Object.fromEntries(Object.entries((scope ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === "string" && v !== "")) as Scope;
/** "1.500" → "1.5": percentages as people write them. */
const pctText = (v: string | null) => (v === null ? null : v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v);

/**
 * Cost rules (M5, E9-1). A rule is versioned, never edited: saving one for the same kind and scope
 * closes the version in force (valid_to = the day before) and starts a new one, so an order's
 * profit always uses the cost of its own day. `resolve` is what the profit service (E9-2) reads.
 */
@Injectable()
export class CostRulesService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  async list(tenantId: string, q: { at?: string; history?: boolean }, now = new Date()) {
    return this.db.tenant(tenantId, async (trx) => {
      const { base, timezone } = await storeClock(trx, tenantId);
      const today = localDay(now, timezone);
      const at = q.at ?? today;
      let rows = trx.selectFrom("cost_rules").select([...SELECT, dayText("valid_from").as("valid_from"), dayText("valid_to").as("valid_to")])
        .orderBy("kind").orderBy("valid_from", "desc").orderBy("created_at", "desc");
      if (!q.history) rows = rows.where("valid_from", "<=", asDate(at)).where((eb) => eb.or([eb("valid_to", "is", null), eb("valid_to", ">=", asDate(at))]));
      return { baseCurrency: base, today, data: (await rows.execute()).map((r) => view(r as Row)) };
    });
  }

  async create(auth: AuthContext, body: CreateCostRule, now = new Date()): Promise<CostRuleView> {
    const tenantId = auth.tenant!.id;
    return this.db.tenant(tenantId, async (trx) => {
      const { base, timezone } = await storeClock(trx, tenantId);
      const today = localDay(now, timezone);
      const from = body.validFrom ?? today;
      if (from < addDays(today, -MAX_BACK_DAYS) || from > addDays(today, MAX_AHEAD_DAYS)) {
        throw new ProblemError(422, "validation_failed", `validFrom must be within ${MAX_BACK_DAYS} days back and ${MAX_AHEAD_DAYS} days ahead`, [{ path: "validFrom", code: "out_of_range" }]);
      }
      const scope = cleanScope(body.scope);
      const minor = (v: string | undefined) => (v === undefined ? null : toMinor(v, base).toString());
      const values = {
        amount_minor: "amount" in body ? minor(body.amount) : null,
        return_minor: body.kind === "courier_rate" ? minor(body.returnAmount) : null,
        fixed_minor: body.kind === "payment_fee_pct" ? minor(body.fixed) : null,
        pct: "pct" in body ? body.pct : null,
        currency: "amount" in body || (body.kind === "payment_fee_pct" && body.fixed !== undefined) ? base : null,
      };

      const same = trx.selectFrom("cost_rules").select([...SELECT, dayText("valid_from").as("valid_from"), dayText("valid_to").as("valid_to")])
        .where("kind", "=", body.kind).where(sql<boolean>`scope = ${JSON.stringify(scope)}::jsonb`);
      const later = await same.where("valid_from", ">", asDate(from)).executeTakeFirst();
      if (later) throw new ProblemError(409, "later_version_exists", `a version starting ${(later as Row).valid_from} exists; end it first`);

      const sameDay = (await same.where("valid_from", "=", asDate(from)).executeTakeFirst()) as Row | undefined;
      let saved: Row;
      if (sameDay) {
        // A correction on the day it starts: the version never applied to anything else yet.
        saved = (await trx.updateTable("cost_rules").set({ ...values, valid_to: null, created_by: auth.user.id }).where("id", "=", sameDay.id)
          .returning([...SELECT, dayText("valid_from").as("valid_from"), dayText("valid_to").as("valid_to")]).executeTakeFirstOrThrow()) as Row;
      } else {
        await trx.updateTable("cost_rules").set({ valid_to: addDays(from, -1) })
          .where("kind", "=", body.kind).where(sql<boolean>`scope = ${JSON.stringify(scope)}::jsonb`)
          .where("valid_from", "<", asDate(from)).where((eb) => eb.or([eb("valid_to", "is", null), eb("valid_to", ">=", asDate(from))])).execute();
        saved = (await trx.insertInto("cost_rules").values({ tenant_id: tenantId, kind: body.kind, scope: JSON.stringify(scope), valid_from: from, created_by: auth.user.id, ...values })
          .returning([...SELECT, dayText("valid_from").as("valid_from"), dayText("valid_to").as("valid_to")]).executeTakeFirstOrThrow()) as Row;
      }
      const after = view(saved);
      await this.audit.record(trx, {
        action: "cost_rule.changed", tenantId, ...auditActor(auth), entity: { type: "cost_rule", id: saved.id },
        before: sameDay ? summary(view(sameDay)) : undefined, after: summary(after),
      });
      await this.events.emit(trx, { type: "costs.changed", tenantId, entity: { type: "cost_rule", id: saved.id }, actor: { type: "user", id: auth.user.id }, data: { kind: body.kind, validFrom: from } });
      return after;
    });
  }

  /** Stops a rule after today (it still applies today). A version that has not started yet is withdrawn. */
  async end(auth: AuthContext, id: string, now = new Date()): Promise<void> {
    const tenantId = auth.tenant!.id;
    await this.db.tenant(tenantId, async (trx) => {
      const { timezone } = await storeClock(trx, tenantId);
      const today = localDay(now, timezone);
      const rule = (await trx.selectFrom("cost_rules").select([...SELECT, dayText("valid_from").as("valid_from"), dayText("valid_to").as("valid_to")])
        .where("id", "=", id).executeTakeFirst()) as Row | undefined;
      if (!rule) throw new ProblemError(404, "not_found", "no such cost rule in this store");
      if (rule.valid_to !== null && rule.valid_to <= today) return; // already over
      if (rule.valid_from > today) await trx.deleteFrom("cost_rules").where("id", "=", id).execute();
      else await trx.updateTable("cost_rules").set({ valid_to: today }).where("id", "=", id).execute();
      await this.audit.record(trx, {
        action: "cost_rule.changed", tenantId, ...auditActor(auth), entity: { type: "cost_rule", id },
        before: summary(view(rule)), after: { ended: today },
      });
      await this.events.emit(trx, { type: "costs.changed", tenantId, entity: { type: "cost_rule", id }, actor: { type: "user", id: auth.user.id }, data: { kind: rule.kind, validFrom: today } });
    });
  }

  /**
   * The one rule of a kind that applies to an order on `day`: rules whose scope keys all match the
   * order's facts, the most specific first (courier + zone > courier > any), then the latest start.
   */
  async resolve(trx: Transaction<DB>, kind: Exclude<CostRuleKind, "fixed_monthly">, facts: Scope, day: string): Promise<CostRuleView | null> {
    const rows = (await trx.selectFrom("cost_rules").select([...SELECT, dayText("valid_from").as("valid_from"), dayText("valid_to").as("valid_to")])
      .where("kind", "=", kind).where("valid_from", "<=", asDate(day)).where((eb) => eb.or([eb("valid_to", "is", null), eb("valid_to", ">=", asDate(day))]))
      .execute()) as Row[];
    const matching = rows.map((r) => ({ r, scope: cleanScope(r.scope) }))
      .filter(({ scope }) => Object.entries(scope).every(([k, v]) => facts[k]?.toLowerCase() === v.toLowerCase()))
      .sort((a, b) => Object.keys(b.scope).length - Object.keys(a.scope).length || b.r.valid_from.localeCompare(a.r.valid_from));
    return matching[0] ? view(matching[0].r) : null;
  }
}

function view(r: Row): CostRuleView {
  const money = (v: string | null) => (v === null || r.currency === null ? null : fromMinor(BigInt(v), r.currency.trim()));
  return {
    id: r.id, kind: r.kind as CostRuleKind, scope: cleanScope(r.scope),
    amount: money(r.amount_minor), returnAmount: money(r.return_minor), fixed: money(r.fixed_minor), pct: pctText(r.pct),
    validFrom: r.valid_from, validTo: r.valid_to, createdAt: r.created_at.toISOString(),
  };
}

/** Audit: amounts and dates only (no personal data in cost rules anyway). */
const summary = (v: CostRuleView) => ({
  kind: v.kind, scope: v.scope, amount: v.amount?.amount ?? null, returnAmount: v.returnAmount?.amount ?? null,
  pct: v.pct, fixed: v.fixed?.amount ?? null, validFrom: v.validFrom, validTo: v.validTo,
});
