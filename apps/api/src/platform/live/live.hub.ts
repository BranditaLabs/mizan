import { Inject, Injectable, Logger, type BeforeApplicationShutdown } from "@nestjs/common";
import { sql } from "kysely";
import { liveTopicsFor, type LiveChange, type LiveEndReason, type LiveTopic } from "@mizan/shared";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { Database } from "../db/database.js";

/** One open stream, as the hub sees it. */
export interface LiveSubscriber {
  readonly tenantId: string;
  readonly role: string;
  readonly topics: ReadonlySet<LiveTopic>;
  change(change: LiveChange): void;
  end(reason: LiveEndReason): void;
}

/**
 * Events committed late (a long transaction stamps occurred_at at its start) are still found:
 * every read looks this far back and skips what it already sent.
 */
export const LIVE_OVERLAP_MS = 60_000;
/** Rows read per poll; a fuller window than this sends `resync` instead of guessing what was missed. */
export const LIVE_POLL_LIMIT = 500;

interface EventRow { id: string; type: string; entity_type: string; entity_id: string; order_id: string | null; occurred_at: Date }
interface NoteRow { id: string; created_at: Date; roles: string[]; entity_type: string | null; entity_id: string | null }

/** One store's feed: polls that store's domain events and notifications, under its RLS context, for every stream open on it. */
class TenantFeed {
  readonly subscribers = new Set<LiveSubscriber>();
  private cursor: Date | null = null;
  /** id → time, for rows inside the overlap window that were already sent. */
  private readonly seen = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  readonly primed: Promise<void>;

  constructor(
    private readonly tenantId: string,
    private readonly db: Database,
    private readonly pollMs: number,
    private readonly logger: Logger,
  ) {
    this.primed = this.poll(true).then(() => this.schedule(), (err) => {
      this.logger.warn({ err }, "live feed could not start");
      this.schedule();
    });
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.poll(false).catch((err) => this.logger.warn({ err }, "live feed poll failed")).finally(() => this.schedule());
    }, this.pollMs);
    this.timer.unref();
  }

  /** Read what is new since the last read. The first read only marks what exists as seen. */
  private async poll(first: boolean): Promise<void> {
    const prime = first || this.cursor === null;
    const { now, events, notes } = await this.db.tenant(this.tenantId, async (trx) => {
      const now = (await sql<{ now: Date }>`SELECT now() AS now`.execute(trx)).rows[0]!.now;
      const since = new Date((this.cursor ?? now).getTime() - LIVE_OVERLAP_MS);
      const events: EventRow[] = await trx.selectFrom("domain_events")
        .select(["id", "type", "entity_type", "entity_id", "occurred_at", sql<string | null>`data->>'orderId'`.as("order_id")])
        .where("occurred_at", ">", since).orderBy("occurred_at", "desc").orderBy("id", "desc").limit(LIVE_POLL_LIMIT).execute();
      const notes: NoteRow[] = await trx.selectFrom("notifications").select(["id", "created_at", "roles", "entity_type", "entity_id"])
        .where("created_at", ">", since).orderBy("created_at", "desc").limit(LIVE_POLL_LIMIT).execute();
      return { now: new Date(now), events, notes };
    });
    if (this.stopped) return;
    const since = new Date((this.cursor ?? now).getTime() - LIVE_OVERLAP_MS).getTime();
    this.cursor = now;
    for (const [id, at] of this.seen) if (at <= since) this.seen.delete(id);

    const fresh = <R extends { id: string }>(rows: R[], at: (r: R) => Date) => {
      const out = rows.filter((r) => !this.seen.has(r.id)).reverse();
      for (const r of rows) this.seen.set(r.id, at(r).getTime());
      // A full window whose oldest row is new may have more new rows behind it.
      const overflow = rows.length === LIVE_POLL_LIMIT && out.length > 0 && out[0] === rows.at(-1);
      return { out, overflow };
    };
    const ev = fresh(events, (r) => r.occurred_at);
    const nt = fresh(notes, (r) => r.created_at);
    if (prime) return;

    if (ev.overflow || nt.overflow) {
      for (const s of this.subscribers) {
        s.change({ id: `resync-${now.getTime()}`, type: "resync", topics: [...s.topics], entity: null, orderId: null, at: now.toISOString() });
      }
      return;
    }
    for (const e of ev.out) {
      const topics = liveTopicsFor({ type: e.type, entity: { type: e.entity_type, id: e.entity_id }, orderId: e.order_id });
      if (!topics.length) continue;
      const orderId = e.entity_type === "order" ? e.entity_id : e.order_id;
      for (const s of this.subscribers) {
        const mine = topics.filter((t) => s.topics.has(t));
        if (mine.length) {
          s.change({ id: e.id, type: e.type as LiveChange["type"], topics: mine, entity: { type: e.entity_type, id: e.entity_id }, orderId, at: e.occurred_at.toISOString() });
        }
      }
    }
    for (const n of nt.out) {
      const entity = n.entity_type && n.entity_id ? { type: n.entity_type, id: n.entity_id } : null;
      for (const s of this.subscribers) {
        if (!s.topics.has("notifications") || !n.roles.includes(s.role)) continue;
        s.change({ id: n.id, type: "notification.created", topics: ["notifications"], entity, orderId: entity?.type === "order" ? entity.id : null, at: n.created_at.toISOString() });
      }
    }
  }
}

/**
 * Fans out each store's domain events to the live streams open on this replica (LV-1a). One feed
 * per store with open streams reads the database (so any replica serves any store) under that
 * store's RLS context: a stream can only ever see its own store's rows.
 */
@Injectable()
export class LiveHub implements BeforeApplicationShutdown {
  private readonly logger = new Logger("LiveHub");
  private readonly feeds = new Map<string, TenantFeed>();
  private closing = false;

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Add a stream; resolves once its store's feed has its starting point, so nothing after it is missed. */
  async subscribe(sub: LiveSubscriber): Promise<() => void> {
    if (this.closing) {
      sub.end("shutdown");
      return () => {};
    }
    let feed = this.feeds.get(sub.tenantId);
    if (!feed) {
      feed = new TenantFeed(sub.tenantId, this.db, this.config.LIVE_POLL_MS, this.logger);
      this.feeds.set(sub.tenantId, feed);
    }
    feed.subscribers.add(sub);
    const leave = () => {
      feed.subscribers.delete(sub);
      if (feed.subscribers.size === 0 && this.feeds.get(sub.tenantId) === feed) {
        feed.stop();
        this.feeds.delete(sub.tenantId);
      }
    };
    await feed.primed;
    return leave;
  }

  /** Streams open on this replica (tests, metrics). */
  get open(): number {
    let n = 0;
    for (const f of this.feeds.values()) n += f.subscribers.size;
    return n;
  }

  /** Open streams are ended before anything else shuts down: the HTTP server cannot close while they are open. */
  beforeApplicationShutdown(): void {
    this.closing = true;
    for (const feed of this.feeds.values()) {
      feed.stop();
      for (const s of [...feed.subscribers]) s.end("shutdown");
    }
    this.feeds.clear();
  }
}
