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
  "tenant.created",
  "member.invited", "member.invitation_revoked", "member.joined", "member.updated", "member.removed",
  "connection.connected", "connection.disconnected", "connection.secret_rotated", "connection.key_saved", "connection.needs_attention",
  "catalog.costs_updated", "onboarding.updated", "cost_rule.changed", "fx.rate_overridden", "ad_spend.changed", "order.duplicate_resolved", "orders.settings_updated",
  "confirmation.link_created", "confirmation.settings_updated", "confirmation.answered_by_agent", "confirmation.call_no_answer",
  "offer.decided", "offer_rule.changed", "offers.settings_updated",
  "integration.job_replayed", "integration.city_resolved",
  "customer.pii_viewed",
  "privacy.request_received", "privacy.request_completed", "privacy.export_downloaded",
  "export.created",
  "secret.created", "secret.rotated", "secret.deleted",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  action: AuditAction;
  /** null for platform-level entries (not tied to a store). */
  tenantId: string | null;
  actor: { type: "user" | "api_key" | "system"; id?: string };
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
