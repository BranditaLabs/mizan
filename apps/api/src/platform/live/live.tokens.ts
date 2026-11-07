import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { can, LIVE_MAX_TOPICS, liveTopicPermission, parseLiveTopic, type LiveTopic, type MemberRole } from "@mizan/shared";
import type { AuthContext } from "../auth/auth.types.js";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { Database } from "../db/database.js";
import { ProblemError } from "../http/problem.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `<tenant uuid>.<43 base64url chars>`: the store id says which RLS context to look the hash up in. */
const TOKEN = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;

/** What a used token grants: one stream for this person in this store, on these topics. */
export interface LiveClaims {
  tenantId: string;
  userId: string;
  role: MemberRole;
  supportGrantId: string | null;
  topics: LiveTopic[];
}

const hash = (secret: string) => createHash("sha256").update(secret).digest();

/** Topics as asked for, checked against the caller's role; duplicates removed, order kept. */
export function checkTopics(raw: readonly string[], role: MemberRole): LiveTopic[] {
  const topics: LiveTopic[] = [];
  for (const r of raw) {
    const t = parseLiveTopic(r);
    if (!t) throw new ProblemError(422, "unknown_topic", `not a live topic: ${r.slice(0, 60)}`);
    const needs = liveTopicPermission(t);
    if (needs && !can(role, needs)) throw new ProblemError(403, "topic_not_allowed", `your role cannot follow ${t.startsWith("order:") ? "orders" : t}`);
    if (!topics.includes(t)) topics.push(t);
  }
  if (topics.length > LIVE_MAX_TOPICS) throw new ProblemError(422, "too_many_topics", `at most ${LIVE_MAX_TOPICS} topics on one stream`);
  return topics;
}

/**
 * Live stream tokens (LV-1a): EventSource cannot send an Authorization header, so the signed-in
 * caller mints a short-lived token and passes it in the query string. Only its hash is stored, in
 * the store's own rows (RLS); it is used once, and any replica can accept it.
 */
@Injectable()
export class LiveTokens {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async mint(auth: AuthContext, rawTopics: readonly string[]): Promise<{ token: string; expiresAt: string; topics: LiveTopic[] }> {
    const tenant = auth.tenant!;
    const topics = checkTopics(rawTopics, tenant.role);
    const secret = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.config.LIVE_TOKEN_TTL_S * 1000);
    await this.db.tenant(tenant.id, async (trx) => {
      // Tokens live seconds: clear this store's old ones as new ones are made.
      await trx.deleteFrom("live_tokens").where("expires_at", "<", new Date(Date.now() - 3_600_000)).execute();
      await trx.insertInto("live_tokens").values({
        token_hash: hash(secret), tenant_id: tenant.id, user_id: auth.user.id, role: tenant.role,
        support_grant_id: auth.support?.grantId ?? null, topics, expires_at: expiresAt,
      }).execute();
    });
    return { token: `${tenant.id}.${secret}`, expiresAt: expiresAt.toISOString(), topics };
  }

  /** Use a token once. Unknown, used and expired tokens answer 401 with their own code. */
  async consume(token: string): Promise<LiveClaims> {
    const m = TOKEN.exec(token);
    if (!m || !UUID.test(m[1]!)) throw new ProblemError(401, "live_token_invalid", "the live token is not valid; ask for a new one");
    const tenantId = m[1]!.toLowerCase();
    const tokenHash = hash(m[2]!);
    const row = await this.db.tenant(tenantId, async (trx) => {
      const used = await trx.updateTable("live_tokens").set({ used_at: new Date() })
        .where("token_hash", "=", tokenHash).where("used_at", "is", null).where("expires_at", ">", new Date())
        .returning(["user_id", "role", "support_grant_id", "topics"]).executeTakeFirst();
      if (used) return used;
      const found = await trx.selectFrom("live_tokens").select(["used_at", "expires_at"]).where("token_hash", "=", tokenHash).executeTakeFirst();
      if (!found) throw new ProblemError(401, "live_token_invalid", "the live token is not valid; ask for a new one");
      if (found.used_at) throw new ProblemError(401, "live_token_used", "this live token was already used; ask for a new one for every connection");
      throw new ProblemError(401, "live_token_expired", "the live token expired; ask for a new one");
    });
    return { tenantId, userId: row.user_id, role: row.role as MemberRole, supportGrantId: row.support_grant_id, topics: row.topics as LiveTopic[] };
  }
}
