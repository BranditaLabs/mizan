import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import { asWorker } from "@mizan/db";
import { matchesEvent, type DomainEvent, type DomainEventType, type EventActor } from "@mizan/shared";
import { APP_CONFIG, runsWorkerInProcess, type AppConfig } from "../config.js";
import { Database } from "../db/database.js";
import { scrubText } from "../logging/redact.js";
import { EVENT_CONSUMER, type EventConsumerOptions, type EventHandler } from "./consumer.js";

export const EVENTS_CLOCK = Symbol("EVENTS_CLOCK");
export type Clock = () => Date;

export const DISPATCH = {
  batchSize: 50,
  leaseMs: 60_000,
  maxAttempts: 10,
  idlePollMs: 1_000,
  maxBackoffMs: 3_600_000,
} as const;

interface Registered extends EventConsumerOptions {
  handler: EventHandler;
}

export interface ClaimedEvent {
  event: DomainEvent;
  attempts: number;
}

export interface DispatchStats {
  claimed: number;
  dispatched: number;
  failed: number;
  dead: number;
}

/** Full-jitter exponential backoff: up to 2^attempts seconds, capped at an hour. */
export function backoffMs(attempts: number, random = Math.random): number {
  return Math.floor(random() * Math.min(DISPATCH.maxBackoffMs, 1000 * 2 ** attempts));
}

/**
 * Delivers domain events to @EventConsumer providers.
 *
 * claim  — as mizan_worker, lease due events (FOR UPDATE SKIP LOCKED); safe with many workers.
 * process — per consumer, in the event's tenant transaction: insert the delivery mark,
 *           run the handler; a mark that already exists means "done before", skip.
 * finish — success: dispatched_at; failure: backoff, last_error, dead after maxAttempts.
 *
 * A crash anywhere leaves the lease to expire; the next claim retries, and the
 * delivery marks keep every consumer's effect exactly-once.
 */
@Injectable()
export class EventDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("EventDispatcher");
  private consumers: Registered[] = [];
  private running = false;
  private loop?: Promise<void>;
  private wake?: () => void;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EVENTS_CLOCK) private readonly clock: Clock,
  ) {}

  onApplicationBootstrap(): void {
    this.consumers = this.discovery.getProviders()
      .filter((w) => w.metatype && w.instance && Reflect.getMetadata(EVENT_CONSUMER, w.metatype))
      .map((w) => ({ ...(Reflect.getMetadata(EVENT_CONSUMER, w.metatype!) as EventConsumerOptions), handler: w.instance as EventHandler }));
    const names = this.consumers.map((c) => c.name);
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) throw new Error(`two event consumers are named "${dup}"`);
    if (runsWorkerInProcess(this.config)) {
      this.start();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  consumerNames(): string[] {
    return this.consumers.map((c) => c.name);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger.log(`dispatching domain events to ${this.consumers.length} consumers`);
    this.loop = (async () => {
      while (this.running) {
        let claimed = 0;
        try {
          claimed = (await this.runOnce()).claimed;
        } catch (err) {
          this.logger.error({ err }, "dispatch cycle failed");
        }
        if (claimed < DISPATCH.batchSize && this.running) {
          await new Promise<void>((resolve) => {
            this.wake = resolve;
            setTimeout(resolve, DISPATCH.idlePollMs);
          });
        }
      }
    })();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.wake?.();
    await this.loop;
    this.logger.log("event dispatcher stopped");
  }

  async runOnce(limit: number = DISPATCH.batchSize): Promise<DispatchStats> {
    const stats: DispatchStats = { claimed: 0, dispatched: 0, failed: 0, dead: 0 };
    for (const claimed of await this.claim(limit)) {
      stats.claimed++;
      const error = await this.process(claimed.event);
      const outcome = await this.finish(claimed, error);
      stats[outcome]++;
    }
    return stats;
  }

  /** Lease up to `limit` due events. */
  async claim(limit: number): Promise<ClaimedEvent[]> {
    const now = this.clock();
    const until = new Date(now.getTime() + DISPATCH.leaseMs);
    const rows = await asWorker(this.db.kysely, (trx) =>
      trx.updateTable("domain_events")
        .set((eb) => ({ locked_until: until, attempts: eb("attempts", "+", 1) }))
        .where("id", "in", (eb) => eb.selectFrom("domain_events").select("id")
          .where("dispatched_at", "is", null).where("dead_at", "is", null)
          .where("next_attempt_at", "<=", now)
          .where((w) => w.or([w("locked_until", "is", null), w("locked_until", "<", now)]))
          .orderBy("occurred_at").orderBy("id").limit(limit)
          .forUpdate().skipLocked())
        .returningAll()
        .execute());
    return rows
      .sort((a, b) => a.occurred_at.getTime() - b.occurred_at.getTime())
      .map((r) => ({
        attempts: r.attempts,
        event: {
          id: r.id,
          type: r.type as DomainEventType,
          tenantId: r.tenant_id,
          occurredAt: r.occurred_at.toISOString(),
          actor: (typeof r.actor === "string" ? JSON.parse(r.actor) : r.actor) as EventActor | null,
          entity: { type: r.entity_type, id: r.entity_id },
          data: (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as Record<string, unknown>,
          version: r.version,
        },
      }));
  }

  /** Deliver to every subscribed consumer not yet delivered. Returns the first error, if any. */
  async process(event: DomainEvent): Promise<Error | undefined> {
    let firstError: Error | undefined;
    for (const consumer of this.consumers) {
      if (!consumer.events.some((p) => matchesEvent(p, event.type))) continue;
      try {
        await this.db.tenant(event.tenantId, async (trx) => {
          const mark = await trx.insertInto("event_deliveries")
            .values({ consumer: consumer.name, event_id: event.id, tenant_id: event.tenantId })
            .onConflict((oc) => oc.columns(["consumer", "event_id"]).doNothing())
            .returning("event_id").executeTakeFirst();
          if (!mark) return; // delivered before: exactly-once
          await consumer.handler.handle(event, trx);
        });
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        this.logger.warn({ err: e, eventId: event.id, consumer: consumer.name }, "event consumer failed");
        firstError ??= new Error(`${consumer.name}: ${e.message}`);
      }
    }
    return firstError;
  }

  /** Release the lease: done, retry later, or dead. */
  async finish(claimed: ClaimedEvent, error: Error | undefined): Promise<"dispatched" | "failed" | "dead"> {
    const now = this.clock();
    const id = claimed.event.id;
    if (!error) {
      await asWorker(this.db.kysely, (trx) => trx.updateTable("domain_events")
        .set({ dispatched_at: now, locked_until: null, last_error: null }).where("id", "=", id).execute());
      return "dispatched";
    }
    const dead = claimed.attempts >= DISPATCH.maxAttempts;
    await asWorker(this.db.kysely, (trx) => trx.updateTable("domain_events").set({
      locked_until: null,
      last_error: scrubText(error.message).slice(0, 1000),
      next_attempt_at: new Date(now.getTime() + backoffMs(claimed.attempts)),
      ...(dead ? { dead_at: now } : {}),
    }).where("id", "=", id).execute());
    if (dead) this.logger.error({ eventId: id, type: claimed.event.type }, "domain event is dead after max attempts");
    return dead ? "dead" : "failed";
  }
}
