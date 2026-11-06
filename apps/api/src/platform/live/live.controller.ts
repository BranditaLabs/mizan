import type { OutgoingHttpHeaders } from "node:http";
import { Body, Controller, Get, HttpCode, Inject, Post, Query, Res } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import { LIVE_SSE_EVENTS, parseLiveTopic, type LiveChange, type LiveEnd, type LiveEndReason, type LiveReady, type LiveTopic } from "@mizan/shared";
import type { z } from "zod";
import { AuthService } from "../auth/auth.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { Auth, Public, SupportMayRead } from "../auth/decorators.js";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { Database } from "../db/database.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod, schemaRef } from "../http/api-schema.js";
import type { HttpReply } from "../http/http.types.js";
import { ProblemError } from "../http/problem.js";
import { TokenBuckets } from "../http/rate-limit.js";
import { ZodPipe } from "../http/zod.pipe.js";
import { LiveChangeSchema, LiveEndSchema, LiveQuerySchema, LiveReadySchema, LiveTokenRequestSchema, LiveTokenSchema } from "./live.dto.js";
import { LiveHub, type LiveSubscriber } from "./live.hub.js";
import { LiveTokens, type LiveClaims } from "./live.tokens.js";

/** Streams one person may hold open in one store on one replica (a browser allows 6 per host anyway). */
export const LIVE_STREAMS_PER_USER = 8;
/** A client this far behind (bytes queued) is cut off; it reconnects and refetches. */
const MAX_QUEUED_BYTES = 1 << 20;

const frame = (event: string, data: unknown, id?: string) => `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * Live updates (LV-1a, docs/16 §4.0). POST /v1/live/token (signed in, X-Tenant-Id) mints a
 * single-use token; GET /v1/live?token=… opens a Server-Sent Events stream of what changes under
 * the token's topics. The stream ends itself after LIVE_MAX_STREAM_MS, or as soon as the person
 * loses access to the store; the client then mints a new token and reconnects.
 */
@ApiTags("live")
@Controller("live")
export class LiveController {
  /** 30 tokens a minute per person: a reconnect every 2 s at worst, plenty for several tabs. */
  private readonly mints = new TokenBuckets(30, 30);
  private readonly perUser = new Map<string, number>();

  constructor(
    @Inject(LiveTokens) private readonly tokens: LiveTokens,
    @Inject(LiveHub) private readonly hub: LiveHub,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post("token")
  @HttpCode(201)
  @SupportMayRead()
  @ApiJsonBody("LiveTokenRequest", LiveTokenRequestSchema)
  @ApiJson(201, "LiveToken", LiveTokenSchema, "A single-use token for one GET /v1/live, valid for LIVE_TOKEN_TTL_S (60 s); mint a new one for every reconnect")
  @ApiProblems(403, 422, 429)
  async token(@Auth() auth: AuthContext, @Body(new ZodPipe(LiveTokenRequestSchema)) body: z.output<typeof LiveTokenRequestSchema>, @Res({ passthrough: true }) res: HttpReply) {
    const r = this.mints.take(`live:${auth.user.id}`);
    if (!r.allowed) {
      res.header("Retry-After", String(Math.max(1, r.resetS)));
      throw new ProblemError(429, "rate_limited", "too many live tokens at once; try again shortly");
    }
    const minted = await this.tokens.mint(auth, body.topics);
    const query = new URLSearchParams({ topics: minted.topics.join(","), token: minted.token });
    return { ...minted, url: `/v1/live?${query.toString()}` };
  }

  @Get()
  @Public()
  @ApiQueryZod(LiveQuerySchema)
  @ApiResponse({
    status: 200,
    description: "text/event-stream: `event: ready` (LiveReady) first, then `event: change` (LiveChange, `id:` = the event id) for each change under the topics, a `:` comment line every heartbeatMs, and `event: end` (LiveEnd) before the server closes. Never compressed or buffered.",
    content: { "text/event-stream": { schema: { oneOf: [schemaRef("LiveReady", LiveReadySchema), schemaRef("LiveChange", LiveChangeSchema), schemaRef("LiveEnd", LiveEndSchema)] } } },
  })
  @ApiProblems(401, 403, 422, 429)
  async stream(@Query(new ZodPipe(LiveQuerySchema)) q: z.output<typeof LiveQuerySchema>, @Res() reply: HttpReply): Promise<void> {
    const claims = await this.tokens.consume(q.token);
    const topics = this.narrow(claims, q.topics);
    const key = `${claims.tenantId}:${claims.userId}`;
    const held = this.perUser.get(key) ?? 0;
    if (held >= LIVE_STREAMS_PER_USER) throw new ProblemError(429, "too_many_streams", `at most ${LIVE_STREAMS_PER_USER} live streams per person`);
    if (!(await this.stillAllowed(claims))) throw new ProblemError(403, "not_a_member", "you are not an active member of this store");
    this.perUser.set(key, held + 1);
    this.open(reply, claims, topics, () => {
      const n = (this.perUser.get(key) ?? 1) - 1;
      if (n > 0) this.perUser.set(key, n);
      else this.perUser.delete(key);
    });
  }

  /** `?topics=` may narrow the token's topics, never widen them. */
  private narrow(claims: LiveClaims, raw: string | undefined): LiveTopic[] {
    if (raw === undefined || raw.trim() === "") return claims.topics;
    const asked: LiveTopic[] = [];
    for (const r of raw.split(",")) {
      const t = parseLiveTopic(r);
      if (!t || !claims.topics.includes(t)) throw new ProblemError(403, "topic_not_in_token", "ask for a token with every topic the stream should carry");
      if (!asked.includes(t)) asked.push(t);
    }
    return asked;
  }

  /** The person may still be here: an active member of an active store, or staff with the same support grant still open. */
  private async stillAllowed(claims: LiveClaims): Promise<boolean> {
    const user = await this.db.platform((trx) => trx.selectFrom("users").select("disabled_at").where("id", "=", claims.userId).executeTakeFirst());
    if (!user || user.disabled_at) return false;
    if (claims.supportGrantId) {
      const grant = await this.auth.supportGrant(claims.tenantId, claims.userId);
      return grant?.grantId === claims.supportGrantId && grant.tenantStatus !== "deleted";
    }
    const m = await this.auth.membership(claims.tenantId, claims.userId);
    return Boolean(m && m.status === "active" && m.role === claims.role && m.tenantStatus !== "suspended" && m.tenantStatus !== "deleted");
  }

  /**
   * Take the socket from Fastify (no onSend hooks: compression never sees the stream) and write
   * SSE frames straight to it. The headers set so far (CORS, security headers, X-Request-Id) are kept.
   */
  private open(reply: HttpReply, claims: LiveClaims, topics: LiveTopic[], released: () => void): void {
    const raw = reply.raw;
    const endsAt = new Date(Date.now() + this.config.LIVE_MAX_STREAM_MS);
    const headers: OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(reply.getHeaders())) if (v !== undefined) headers[k] = v as OutgoingHttpHeaders[string];
    delete headers["content-length"];
    delete headers["content-encoding"];
    reply.hijack();
    raw.writeHead(200, {
      ...headers,
      "content-type": "text/event-stream; charset=utf-8",
      // no-transform: proxies and CDNs (Front Door) must not compress or rewrite the stream.
      "cache-control": "no-cache, no-store, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    });
    raw.socket?.setNoDelay(true);
    raw.flushHeaders();

    let closed = false;
    let leave: (() => void) | undefined;
    const timers: NodeJS.Timeout[] = [];
    const write = (chunk: string) => {
      if (closed) return;
      raw.write(chunk);
      if (raw.writableLength > MAX_QUEUED_BYTES) finish();
    };
    const finish = (reason?: LiveEndReason) => {
      if (closed) return;
      if (reason) raw.write(frame(LIVE_SSE_EVENTS.end, { reason } satisfies LiveEnd));
      closed = true;
      for (const t of timers) clearInterval(t);
      leave?.();
      released();
      raw.end();
    };
    raw.on("close", () => finish());

    // Changes start after `ready` (the client refetches once on ready, so nothing before it is lost).
    let ready = false;
    const sub: LiveSubscriber = {
      tenantId: claims.tenantId,
      role: claims.role,
      topics: new Set(topics),
      change: (change: LiveChange) => { if (ready) write(frame(LIVE_SSE_EVENTS.change, change, change.id)); },
      end: (reason) => finish(reason),
    };
    timers.push(setInterval(() => write(":\n\n"), this.config.LIVE_HEARTBEAT_MS));
    timers.push(setTimeout(() => finish("expired"), this.config.LIVE_MAX_STREAM_MS));
    let checking = false;
    timers.push(setInterval(() => {
      if (checking || closed) return;
      checking = true;
      this.stillAllowed(claims).then((ok) => { if (!ok) finish("revoked"); }, () => {}).finally(() => { checking = false; });
    }, this.config.LIVE_RECHECK_MS));
    for (const t of timers) t.unref();

    this.hub.subscribe(sub).then((unsubscribe) => {
      if (closed) return unsubscribe();
      leave = unsubscribe;
      write(frame(LIVE_SSE_EVENTS.ready, { topics, heartbeatMs: this.config.LIVE_HEARTBEAT_MS, endsAt: endsAt.toISOString() } satisfies LiveReady));
      ready = true;
    }, () => finish());
  }
}
