import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import type { AuthContext } from "../auth/auth.types.js";
import { redactDeep } from "../logging/redact.js";

/**
 * Sensitive actions that must leave a trace (docs/07). Modules add theirs here.
 * Naming: <entity>.<verb>, past tense.
 */
export const AUDIT_ACTIONS = [
  "tenant.created", "tenant.updated",
  "member.invited", "member.invitation_revoked", "member.joined", "member.updated", "member.removed",
  "connection.connected", "connection.disconnected", "connection.secret_rotated", "connection.key_saved", "connection.needs_attention", "connection.sync_updated",
  "catalog.costs_updated", "catalog.variant_updated", "catalog.costs_imported", "stock.recorded", "stock.threshold_set", "stock.settings_updated", "picklist.created", "picklist.closed", "supplier.created", "supplier.updated", "po.created", "po.updated", "po.approved", "po.sent", "po.cancelled", "po.received", "po.landed_cost_added", "po.landed_cost_removed", "purchasing.settings_updated", "ops.synced", "automation.created", "automation.updated", "automation.enabled", "automation.disabled", "automation.deleted", "onboarding.updated", "cost_rule.changed", "fx.rate_overridden", "ad_spend.changed", "order.duplicate_resolved", "orders.settings_updated", "order.created_manually", "orders.bulk_requested", "payment.recorded", "ticket.created", "ticket.updated", "refund.requested", "refund.approved", "refund.rejected", "refund.completed", "refunds.settings_updated", "return.inspected", "plan.upgrade_requested", "shipment.requested", "shipment.recorded", "shipment.status_set", "shipment.statuses_imported", "exchange.created", "order.partial_delivery_recorded", "order.refusal_recorded",
  "confirmation.link_created", "confirmation.settings_updated", "confirmation.answered_by_agent", "confirmation.call_no_answer",
  "offer.decided", "offer_rule.changed", "offers.settings_updated",
  "integration.job_replayed", "integration.city_resolved",
  "customer.pii_viewed",
  "privacy.request_received", "privacy.request_completed", "privacy.export_downloaded",
  "export.created",
  "secret.created", "secret.rotated", "secret.deleted",
  "store.suspended", "store.reactivated", "store.plan_changed", "support.access_started", "support.access_ended", "user.sign_in_disabled", "user.sign_in_enabled",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  action: AuditAction;
  /** null for platform-level entries (not tied to a store). */
  tenantId: string | null;
  /** mizan_staff: a Mizan staff member acting from the back office (id = their staff id, not a user). */
  actor: { type: "user" | "api_key" | "system" | "mizan_staff"; id?: string };
  entity?: { type: string; id: string };
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
}

/** Actor and IP of the current request, for AuditEntry. */
export const auditActor = (auth: AuthContext) => ({ actor: { type: "user" as const, id: auth.user.id }, ip: auth.ip });

/**
 * Append-only audit trail (audit_log; the app role cannot update or delete).
 * Record inside the transaction that makes the change: no change without its entry.
 * before/after go through the PII redactor: record roles, statuses and ids, not contact details.
 */
@Injectable()
export class AuditService {
  async record(trx: Transaction<DB>, entry: AuditEntry): Promise<void> {
    await trx.insertInto("audit_log").values({
      tenant_id: entry.tenantId,
      actor_type: entry.actor.type,
      actor_id: entry.actor.id ?? null,
      action: entry.action,
      entity_type: entry.entity?.type ?? null,
      entity_id: entry.entity?.id ?? null,
      before: entry.before ? JSON.stringify(redactDeep(entry.before)) : null,
      after: entry.after ? JSON.stringify(redactDeep(entry.after)) : null,
      ip: entry.ip && /^[0-9a-fA-F:.]+$/.test(entry.ip) ? entry.ip : null,
    }).execute();
  }
}
