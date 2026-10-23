import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Transaction } from "kysely";
import { asWorker, type DB } from "@mizan/db";
import { parseWhatsAppWebhook, verifyChallenge, verifyMetaSignature, type InboundMessage, type StatusUpdate } from "@mizan/engine";
import { APP_CONFIG, type AppConfig } from "../../platform/config.js";
import { Database } from "../../platform/db/database.js";
import { ProblemError } from "../../platform/http/problem.js";
import { PiiCipher, type TenantPii } from "../../platform/pii/pii-cipher.js";
import { parseActionId, type ChatAction } from "./confirmation-link.js";
import { ConfirmationService, type RunRow } from "./confirmation.service.js";
import { CANCEL_REASONS, type CancelReason, type ChatMessage } from "./messages.js";
import { MessagingRegistry } from "./messaging.registry.js";
import { OffersService } from "./offers/offers.service.js";

/** Delivery order; a late "delivered" never overwrites "read", "failed" is final. */
const RANK: Record<string, number> = { accepted: 0, received: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
const OPEN = ["new", "pending_confirmation"];
const LIVE = ["running", "needs_agent"];
/** A typed message or a location counts for a run started within this long. */
const RECENT_MS = 7 * 86_400_000;

/**
 * The confirmation conversation on WhatsApp (E6-10). Meta posts every number's messages and
 * delivery statuses to one URL; each is verified, found its store by the number's id, deduplicated
 * by Meta's message id and applied in that store's transaction (database only; any message back
 * to the customer is a queued step, sent by the runner). The customer only taps:
 *
 *   template [Confirm] → confirmed, "Done ✅"
 *   template [Change]  → the team calls back; whatever they type next is the note
 *   template [Cancel]  → a list of reasons (or "keep my order"); a reason cancels
 *   anything typed     → the team sees it and calls ("Got it ✍️")
 *
 * Button ids are signed (confirmation-link.ts): a forged or edited id does nothing.
 */
@Injectable()
export class WhatsAppChat {
  private readonly logger = new Logger("WhatsApp");

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PiiCipher) private readonly cipher: PiiCipher,
    @Inject(ConfirmationService) private readonly confirmations: ConfirmationService,
    @Inject(MessagingRegistry) private readonly registry: MessagingRegistry,
    @Inject(OffersService) private readonly offers: OffersService,
  ) {}

  /** Meta's subscription check (GET). */
  challenge(query: Record<string, unknown>): string {
    const token = this.config.WHATSAPP_VERIFY_TOKEN;
    const answer = token ? verifyChallenge(query, token) : null;
    if (!answer) throw new ProblemError(403, "forbidden", "verify token does not match");
    return answer;
  }

  /** A webhook delivery (POST): verify, route, dedupe, apply. Throws to make Meta retry. */
  async receive(signature: string | undefined, raw: string, now = new Date()): Promise<{ status: number; body: Record<string, unknown> }> {
    const secret = this.config.META_APP_SECRET;
    if (!secret) return { status: 503, body: { error: "whatsapp not configured" } };
    if (!verifyMetaSignature(raw, signature, secret)) return { status: 401, body: { error: "invalid signature" } };
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return { status: 400, body: { error: "invalid json" } }; }
    const parsed = parseWhatsAppWebhook(body, this.registry.drift, () => now.getTime());
    let applied = 0;
    const routes = new Map<string, { tenantId: string; connectionId: string } | null>();
    const route = async (phoneNumberId: string) => {
      if (!routes.has(phoneNumberId)) {
        const c = await asWorker(this.db.kysely, (trx) => trx.selectFrom("connections").select(["id", "tenant_id", "status"])
          .where("provider", "=", "whatsapp_cloud").where("external_account", "=", phoneNumberId).where("status", "!=", "disconnected").executeTakeFirst());
        routes.set(phoneNumberId, c ? { tenantId: c.tenant_id, connectionId: c.id } : null);
      }
      return routes.get(phoneNumberId)!;
    };
    // Statuses first: a send's status can arrive in the same delivery as the reply to it.
    for (const s of parsed.statuses) {
      const r = await route(s.phoneNumberId);
      if (!r) continue;
      await this.db.tenant(r.tenantId, (trx) => this.onStatus(trx, r.tenantId, r.connectionId, s, now));
      applied++;
    }
    for (const m of parsed.messages) {
      const r = await route(m.phoneNumberId);
      if (!r) continue;
      await this.db.tenant(r.tenantId, (trx) => this.onMessage(trx, r.tenantId, r.connectionId, m, now));
      applied++;
    }
    return { status: 200, body: { received: applied } };
  }

  // ───────────── statuses ─────────────

  private async onStatus(trx: Transaction<DB>, tenantId: string, connectionId: string, s: StatusUpdate, now: Date): Promise<void> {
    const status = s.status === "unknown" ? "sent" : s.status;
    const row = await trx.selectFrom("whatsapp_messages").select(["id", "status", "kind", "run_id", "step_key"]).where("wamid", "=", s.id).forUpdate().executeTakeFirst();
    if (!row) {
      // Before our send recorded it (its response was lost or is still on the way): the key says which step.
      await trx.insertInto("whatsapp_messages").values({
        tenant_id: tenantId, connection_id: connectionId, direction: "out", wamid: s.id, kind: "unknown", status, error_code: s.errorCode ?? null, step_key: s.key ?? null, created_at: now, updated_at: now,
      }).onConflict((oc) => oc.columns(["tenant_id", "wamid"]).doNothing()).execute();
    } else if ((RANK[status] ?? 0) > (RANK[row.status] ?? 0)) {
      await trx.updateTable("whatsapp_messages").set({ status, error_code: s.errorCode ?? null, updated_at: now }).where("id", "=", row.id).execute();
    } else return;
    if (status !== "failed") return;
    // The question never reached the customer (no WhatsApp, blocked): move on now instead of waiting.
    const key = row?.step_key ?? s.key;
    if (!key) return;
    const step = await trx.selectFrom("confirmation_steps").select(["run_id", "idx", "kind"]).where("idempotency_key", "=", key).executeTakeFirst();
    if (!step || step.kind !== "send") return;
    const run = await this.confirmations.runById(trx, step.run_id, true);
    if (run.status !== "running" || run.step !== step.idx) return;
    await this.confirmations.cancelSteps(trx, run.id, now);
    await this.confirmations.advance(trx, tenantId, run, step.idx + 1, now);
  }

  // ───────────── messages ─────────────

  private async onMessage(trx: Transaction<DB>, tenantId: string, connectionId: string, m: InboundMessage, now: Date): Promise<void> {
    const pii = await this.cipher.forTenant(trx, tenantId);
    const hash = pii.phoneHash(`+${m.from}`);
    const inserted = await trx.insertInto("whatsapp_messages").values({
      tenant_id: tenantId, connection_id: connectionId, direction: "in", wamid: m.id, kind: m.kind, status: "received", customer_hash: hash, created_at: now, updated_at: now,
    }).onConflict((oc) => oc.columns(["tenant_id", "wamid"]).doNothing()).returning("id").executeTakeFirst();
    if (!inserted) return; // a redelivery: already handled
    const handled = await this.handle(trx, tenantId, m, hash, pii, now);
    await trx.updateTable("whatsapp_messages").set({ run_id: handled.run?.id ?? null, order_id: handled.run?.order_id ?? null, action: handled.action }).where("id", "=", inserted.id).execute();
  }

  private async handle(trx: Transaction<DB>, tenantId: string, m: InboundMessage, hash: string, pii: TenantPii, now: Date): Promise<{ run: RunRow | null; action: string }> {
    if (m.reply) {
      const tap = parseActionId(this.config.LINK_SIGNING_KEY, m.reply);
      if (!tap) return { run: null, action: "ignored" };
      const run = await trx.selectFrom("confirmation_runs").select("id").where("id", "=", tap.runId).executeTakeFirst();
      if (!run) return { run: null, action: "ignored" }; // another store's run is invisible here (RLS)
      const locked = await this.confirmations.runById(trx, run.id, true);
      return { run: locked, action: await this.onTap(trx, tenantId, locked, tap.action, tap.arg, m.id, now) };
    }
    const run = await this.recentRun(trx, hash, now);
    if (!run) return { run: null, action: m.kind === "text" ? "message" : "ignored" };
    if (m.kind === "location" && m.location) {
      const order = await trx.selectFrom("orders").select("status").where("id", "=", run.order_id).executeTakeFirstOrThrow();
      if (["new", "pending_confirmation", "confirmed"].includes(order.status)) {
        await trx.updateTable("orders").set({ ship_lat: m.location.lat, ship_lng: m.location.lng }).where("id", "=", run.order_id).execute();
        await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: run.order_id, type: "location_shared", actor_type: "customer", data: JSON.stringify({ channel: "whatsapp" }) }).execute();
      }
      return { run, action: "location" };
    }
    if (m.kind !== "text" || !m.text) return { run, action: "ignored" };
    if (run.chat_state === "awaiting_change") {
      // The change they asked for, in their words: encrypted on the change request.
      const note = m.text.slice(0, 500);
      const change = await trx.selectFrom("confirmations").select(["id", "notes"]).where("run_id", "=", run.id).where("outcome", "=", "changed").orderBy("started_at", "desc").executeTakeFirst();
      const before = change?.notes ? pii.decrypt(change.notes, "confirmations.notes") : null;
      const text = before ? `${before}\n${note}`.slice(0, 1000) : note;
      if (change) await trx.updateTable("confirmations").set({ notes: pii.encrypt(text, "confirmations.notes") }).where("id", "=", change.id).execute();
      await trx.updateTable("confirmation_runs").set({ chat_state: null }).where("id", "=", run.id).execute();
      await trx.insertInto("order_events").values({ tenant_id: tenantId, order_id: run.order_id, type: "change_note", actor_type: "customer", data: JSON.stringify({ channel: "whatsapp" }) }).execute();
      await this.reply(trx, tenantId, run, "change_received", m.id, now);
      return { run, action: "note" };
    }
    // Anything else they type goes to the team, who call back.
    if (LIVE.includes(run.status)) {
      if (run.status === "running") await this.confirmations.escalate(trx, tenantId, run, "customer_message", now);
      await this.reply(trx, tenantId, run, "noted", m.id, now);
    }
    return { run, action: "message" };
  }

  private async onTap(trx: Transaction<DB>, tenantId: string, run: RunRow, action: ChatAction, arg: string | undefined, inbound: string, now: Date): Promise<string> {
    const order = await trx.selectFrom("orders").select("status").where("id", "=", run.order_id).executeTakeFirstOrThrow();
    const open = LIVE.includes(run.status) && OPEN.includes(order.status) && run.outcome !== "changed";
    const answer = async (a: "confirm" | "cancel" | "change", reason?: CancelReason) => {
      try {
        await this.confirmations.applyAnswer(trx, tenantId, run.order_id, run, { answer: a, channel: "whatsapp", actor: { type: "customer" }, ...(reason ? { reason } : {}) }, now);
        return true;
      } catch (err) {
        if (err instanceof ProblemError && err.status === 409) return false;
        throw err;
      }
    };
    switch (action) {
      case "confirm":
      case "keep":
        if (open && (await answer("confirm"))) {
          // With an offer for this run (E6-11), the thank-you carries it, with Add / No thanks.
          const offer = await this.offers.forRun(trx, run.id);
          const show = offer?.status === "proposed" && (await this.offers.settings(trx, tenantId)).inWhatsApp;
          await this.reply(trx, tenantId, run, show ? "confirmed_offer" : "confirmed", inbound, now);
          return action;
        }
        if (run.outcome !== "confirmed") await this.reply(trx, tenantId, run, "already", inbound, now);
        return "late";
      case "change":
        if (open && (await answer("change"))) {
          await trx.updateTable("confirmation_runs").set({ chat_state: "awaiting_change" }).where("id", "=", run.id).execute();
          await this.reply(trx, tenantId, run, "change_prompt", inbound, now);
          return "change";
        }
        if (run.outcome !== "changed") await this.reply(trx, tenantId, run, "already", inbound, now);
        return "late";
      case "cancel":
        if (open) {
          await trx.updateTable("confirmation_runs").set({ chat_state: "awaiting_reason" }).where("id", "=", run.id).execute();
          await this.reply(trx, tenantId, run, "cancel_reasons", inbound, now);
          return "cancel";
        }
        if (run.outcome !== "cancelled") await this.reply(trx, tenantId, run, "already", inbound, now);
        return "late";
      case "reason": {
        const reason = (CANCEL_REASONS as readonly string[]).includes(arg ?? "") ? (arg as CancelReason) : "other";
        if (open && (await answer("cancel", reason))) { await this.reply(trx, tenantId, run, "cancelled", inbound, now); return "reason"; }
        if (run.outcome !== "cancelled") await this.reply(trx, tenantId, run, "already", inbound, now);
        return "late";
      }
      case "offer_yes":
      case "offer_no": {
        const offer = await this.offers.forRun(trx, run.id);
        if (!offer || offer.id !== arg) return "ignored";
        const r = await this.offers.decide(trx, tenantId, offer.id, action === "offer_yes" ? "accept" : "decline", { channel: "whatsapp" }, now);
        if (!r.changed) return "late"; // a second tap: already answered
        await this.reply(trx, tenantId, run, r.status === "accepted" ? "offer_added" : r.status === "declined" ? "offer_declined" : "offer_expired", inbound, now);
        return action;
      }
      default:
        return "ignored";
    }
  }

  private reply(trx: Transaction<DB>, tenantId: string, run: RunRow, message: ChatMessage, inbound: string, now: Date) {
    return this.confirmations.queueReply(trx, tenantId, run, message, inbound, now);
  }

  /** The customer's latest run (a typed message or a location has no button to say which order). */
  private async recentRun(trx: Transaction<DB>, hash: string, now: Date): Promise<RunRow | null> {
    const row = await trx.selectFrom("confirmation_runs").select("id").where("customer_hash", "=", hash)
      .where("started_at", ">", new Date(now.getTime() - RECENT_MS)).orderBy("started_at", "desc").executeTakeFirst();
    return row ? this.confirmations.runById(trx, row.id, true) : null;
  }
}
